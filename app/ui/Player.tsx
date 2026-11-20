// The player: the video view (mpv or the platform's, VideoSurface) on the local stream under our own
// controls (design/concept/tv-player.html). Until the first frame plays, and
// when the film cannot play, the stage (PlayerStage) fills the screen and
// only Back works; a stall after that is a small note over the picture.
// The overlay shows on any key,
// press or mouse move and hides after a few quiet seconds, unless the film
// is paused, buffering or the tracks panel is open. Remote: Space/Enter
// play or pause, Left/Right seek 10 s on the scrubber row (move between
// buttons on the buttons row), Up/Down switch rows, Escape closes the
// panel, then hides the overlay, then leaves. Near the end of an episode
// the Up next card (tv-player-end.html) takes the remote instead.
import { cleanup, computed, createAnimatedValue, effect, Image, keymap, lifecycle, safeArea, Scroll, signal, Text, untracked, View, windowSize, type ImageAsset, type TextStyle, type ViewStyle } from "nsh";
import { BufferingNote, PlayerStage, WaitingLine, type StageLine } from "./PlayerStage";
import { t } from "nsh/i18n";
import { Catalog, Fmt, VideoEngine } from "./native";
import { episodeCode, episodeText, runtime, titleText, type Episode, type Release } from "./catalog";
import { Icon } from "./components";
import { rounded } from "./kit/shape";
import plusIcon from "./icons/plus.svg";
import { streamDetails } from "./preferences";
import { cachedAhead, currentJob, duration, firstFrame, readAt, playing as what, play, position, startAt, status as core, stop, timeline } from "./playback";
import { chrome, frame, sideSafeArea, windowControlsRoom } from "./layout/chrome";
import { alpha, colors, density, focusRing, font, iconPt, radius, safe, showFocus, targetSlop, ts as layoutTs, type, u as layoutU } from "./theme";

/** A phone: play and ±10 s in the middle of the picture, under the thumbs; the secondary buttons
 * at the top right, opposite the ✕; the bottom keeps only the timeline, lifted off the home
 * indicator. */
const PHONE = () => chrome() === "phone";
/** On a phone the player is held at arm's length over a film: its controls are one and a half
 * times the layout's size (a 68 px button 46 pt, not 31) and its text a quarter larger (times 18 pt). */
const PHONE_CONTROLS = () => (density() === "compact" ? 1.5 : 1);
const PHONE_TEXT = () => (density() === "compact" ? 1.25 : 1);
const u = (px: number) => layoutU(px) * PHONE_CONTROLS();
const ts = (px: number) => layoutTs(px) * PHONE_TEXT();
import { caps } from "./platform";
import { playVolume, PlayerVolume, toggleMute, volumeShown } from "./PlayerVolume";
import { TrackSlider } from "./kit/TrackSlider";
import { useFullscreen } from "./platform/window";
import { BarBack, barBackBox } from "./layout/WindowBar";
import { onBack } from "./nav";
import { SubtitleOverlay, subtitleBottom, subtitleFit, subtitleRest, subtitleScale } from "./SubtitleOverlay";
import { playerTracks } from "./tracks";
import { trackHeadings, trackRows, TracksSheet, type TrackRow } from "./PlayerTracks";
import { VideoSurface, videoUnderUi, type SurfaceRef } from "./VideoSurface";
import playIcon from "./icons/play.svg";
import pauseIcon from "./icons/pause.svg";
import rewindIcon from "./icons/rewind.svg";
import forwardIcon from "./icons/forward.svg";
import tracksIcon from "./icons/tracks.svg";
import fullscreenIcon from "./icons/fullscreen.svg";
import fullscreenExitIcon from "./icons/fullscreen-exit.svg";
import rotateIcon from "./icons/rotate.svg";
import episodesIcon from "./icons/episodes.svg";
import { PlayerEpisodes } from "./PlayerEpisodes";
import checkIcon from "./icons/check.svg";
import { Pressable } from "./kit/Pressable";

/** How long the overlay stays without input. */
export const OVERLAY_MS = 5000;
/** How long the Up next card counts down before the next episode plays. */
export const UP_NEXT_MS = 6000;
const SEEK_S = 10;
/** Held, the arrows step further: after this many steps 30 s, after that many 60 s. */
const SCRUB_FASTER = [8, 20];
/** Presses closer than this, ms, are one hold (a key's repeat). */
const SCRUB_HOLD_MS = 300;
/** The player seeks once the arrows have rested this long, ms: one seek for a run of presses. */
const SCRUB_IDLE_MS = 600;
/** How long a wait lasts before the buffering note shows, ms. */
const STALL_MS = 300;

type Row = "scrubber" | "buttons";
/** A phone: the tracks and the episodes are sheets (bottom, or at the right held sideways), not
 * panels over the picture, which would be three narrow columns there and cover the ✕. */
const SHEETS = () => frame().panel === "bottom-sheet";
/** The desktop's Back over the picture: the bar's, on a dark fill. */
const PLAYER_BACK_FILL = "#2A2A2AD9";
/** Where it sits: the bar's Back slot, or (20, 12) in full screen. */
const barBackSlot = (full: boolean): ViewStyle => {
  const b = barBackBox(full);
  return { position: "absolute", top: b.top, left: b.left, zIndex: 3 };
};
/** Touch's ✕, points: 44 on a tablet at (24, 24), 40 on a phone at the
 * landscape safe area's left (x 62 beside a Dynamic Island). */
const CLOSE = () => (chrome() === "tablet" ? 44 : 40);
const touchCorner = () =>
  chrome() === "tablet" ? { top: 24, left: Math.max(24, windowControlsRoom()) } : { top: Math.max(18, safeArea().top), left: Math.max(20, sideSafeArea().left, windowControlsRoom()) };
const closeDisc = (): ViewStyle => ({
  width: CLOSE(),
  height: CLOSE(),
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: PLAYER_BACK_FILL,
});

/** ✕ (touch): leaves the player. */
function CloseButton(props: { onPress: () => void }) {
  return (
    <Pressable role="button" hitSlop={targetSlop(CLOSE())} accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeDisc()}>
      <View style={{ transform: "rotate(45deg)" }}>
        <Icon src={() => plusIcon} size={iconPt(17)} />
      </View>
    </Pressable>
  );
}

/** The title block's place: beside the desktop's Back or touch's ✕, at the safe area's corner on a TV. */
const topRowStyle = (full: boolean): ViewStyle => ({
  position: "absolute",
  top: caps.windowBar ? barBackBox(full).top : caps.touch ? touchCorner().top : safe().y,
  left: caps.windowBar ? barBackBox(full).left + barBackBox(full).width + 12 : caps.touch ? touchCorner().left : safe().x,
  right: safe().x,
  flexDirection: "row",
  alignItems: "flex-start",
  gap: u(24),
});

const BUTTONS = ["back", "play", "forward", "tracks", "episodes", "fullscreen", "rotate"] as const;
type ButtonId = (typeof BUTTONS)[number];
const PLAY_BUTTON = 1;
/** The buttons a phone shows in the middle of the picture; the rest stay in the bottom row. */
const MIDDLE: readonly ButtonId[] = ["back", "play", "forward"];
/** A round button's size, TV pixels (times the phone's controls); the phone's middle Play is larger. */
const BUTTON = 68;
const BIG_BUTTON = 96;
/** The bottom controls' distance from the screen's bottom: a phone's clear of the home indicator
 * by 16 pt. */
const controlsBottom = () => (PHONE() ? Math.max(safe().y, safeArea().bottom + 16) : safe().y);
/** The times under the scrubber (and a phone's waiting line between them). */
const timeText = (color: string): TextStyle => ({ fontFamily: font, fontSize: ts(24), fontWeight: 500, color });

interface Tracks {
  releases: Release[];
}

/** The player's own background: none where the picture is under the UI (the
 * stage and the overlays keep theirs). */
const screenBackground = () => (videoUnderUi() ? "transparent" : colors.ink());

export function Player() {
  // Computed, so the twice-a-second status from the core wakes only what changed
  // (a fresh status object must not restart the overlay's hide timer).
  const ready = computed(() => core().phase === "ready");
  const url = computed(() => { const s = core(); return s.phase === "ready" ? s.stream_url : ""; });
  const lowSpace = computed(() => { const s = core(); return s.phase === "ready" && s.low_space; });

  let surface: SurfaceRef | undefined;
  /** Leaving: the view goes quiet at once (it is torn down a moment later, after the screen
   * changed: on iOS the player's dialog fades out first, and its sound went on meanwhile). */
  const leaving = signal(false);
  const leave = () => {
    leaving.set(true);
    setTimeout(stop, 0);
  };
  const paused = signal(false);
  const loaded = signal(false);
  /** What `onBuffer` last said. */
  const buffering = signal(false);
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(stallTimer));
  /** What the video view said went wrong: its words, and a code when the UI words it itself. */
  const error = signal<{ message: string; code?: string } | null>(null);
  /** The first frame played: the stage gives way to the picture and the controls. */
  const started = signal(false);
  /** Where the film resumes once loaded; it has started when it plays from there. */
  let resumeTo = 0;
  // A new stream (the next episode, another release): wait for its first frame again.
  effect(() => {
    url();
    loaded.set(false);
    started.set(false);
    clearTimeout(stallTimer);
    buffering.set(false);
    error.set(null);
  });

  const overlay = signal(true);
  const row = signal<Row>("scrubber");
  const button = signal(PLAY_BUTTON);
  /** The buttons this device has: full screen only where the window can fill the screen. */
  /** The episode playing, from its key (`…:s3e10`): a start from Continue watching names no season. */
  const episodeOf = () => {
    const m = /:s(\d+)e(\d+)$/.exec(what()?.id ?? "");
    return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
  };
  const buttons: ButtonId[] = BUTTONS.filter(
    (b) => (b !== "fullscreen" || caps.fullscreen) && (b !== "rotate" || caps.rotate) && (b !== "episodes" || episodeOf() != null),
  );
  /** The bottom row's buttons: none on a phone, whose bottom keeps only the timeline (its
   * secondary buttons are at the top, `topButtons`; Play and ±10 s in the middle). */
  const bottomButtons = PHONE() ? [] : buttons;
  /** A phone's secondary buttons (Audio and subtitles, Episodes, Rotate): at the top right,
   * opposite the ✕, so the picture keeps the room a bottom row took. */
  const topButtons = PHONE() ? buttons.filter((b) => !MIDDLE.includes(b)) : [];
  const middleButtons = PHONE() ? buttons.filter((b) => MIDDLE.includes(b)) : [];
  /** On touch, Episodes and Rotate keep to the right edge: the first of them pushes the rest there
   * (on a computer the volume has the right). */
  const rightFrom: ButtonId | undefined = caps.touch ? buttons.find((b) => b === "episodes" || b === "rotate") : undefined;
  /** The show's episodes in a panel (a series only). */
  const episodesOpen = signal(false);
  /** The window fills the screen (desktops). Left as it was found when the player closes. */
  const { on: fullscreen, set: setFullscreen } = useFullscreen();
  /** Rotate: to the other orientation than the window's now. */
  const turn = () => {
    const { width, height } = windowSize();
    VideoEngine.turn(width <= height);
  };
  // A phone is upright again when the player closes, however it came to be sideways (Rotate,
  // the film's own turn, the phone turned in the hand after Rotate upright): else the app
  // stayed sideways with the rotation lock on.
  if (caps.rotate) cleanup(() => VideoEngine.turn(false));
  /** The phone's orientation as the app left for the background (null: in front). iOS brings it
   * back as the phone is held, which undid a turn the player asked for (Rotate, the film's own):
   * back in front, the player keeps the orientation it had. */
  let leftSideways: boolean | null = null;
  if (caps.rotate)
    effect(() => {
      const state = lifecycle();
      untracked(() => {
        if (state !== "active") {
          if (leftSideways == null) leftSideways = windowSize().width > windowSize().height;
        } else if (leftSideways != null) {
          // Asked whatever the window says now: iOS may turn it a moment after the app is back.
          VideoEngine.turn(leftSideways);
          leftSideways = null;
        }
      });
    });
  /** A phone held upright turns sideways as the player opens, before the picture's size is
   * known: mpv's output then starts at the sideways size (turned once it had started upright,
   * the film played on without a picture). Once the film loads, a picture taller than wide (the
   * core says) turns it back upright. Only for the player's first load: not again for the next
   * episode, which keeps what the viewer chose. */
  let turnedSideways = false;
  if (PHONE() && caps.rotate) {
    const w = untracked(windowSize);
    if (w.width <= w.height) {
      VideoEngine.turn(true);
      turnedSideways = true;
    }
  }
  const turnForPicture = (width?: number, height?: number) => {
    if (!turnedSideways) return;
    turnedSideways = false;
    if (!leaving() && !VideoEngine.sideways(width ?? 0, height ?? 0)) VideoEngine.turn(false);
  };

  // The tracks panel: three columns, the focus inside it while it is open.
  const panel = signal(false);
  const panelCol = signal(0);
  const panelRow = signal(0);
  const tracks = computed<Tracks>(() => JSON.parse(Catalog.tracks(what()?.id ?? "")));
  /** The release picked in the panel (shown; switching releases is the catalog's). */
  const picked = signal<Record<number, number>>({});
  /** The bottom controls' height: the subtitles sit above them while they show. */
  const controlsHeight = signal(0);
  /** The widths of the times under the scrubber (current, left), on a phone: its waiting line
   * sits between them. */
  const timeWidths = signal<[number, number]>([0, 0]);
  /** The picture's width over its height, once the view says. */
  const pictureAspect = signal<number | undefined>(undefined);
  /** The phone's middle buttons show (Play and ±10 s over the picture's centre). */
  const middleShown = () => middleButtons.length > 0 && ready() && overlay() && !staged() && !panel() && !episodesOpen() && !card();
  /** How far from the window's bottom the subtitles stay above (`subtitleBottom`): the controls'
   * top edge while they show, clear of the middle buttons, at the picture's bottom held upright;
   * 0 where nothing lifts them off their rest. */
  const subtitlesAbove = () => {
    const controls = overlay() && !card() && controlsHeight() > 0 ? controlsBottom() + controlsHeight() + u(12) : 0;
    const bottom = subtitleBottom({
      window: windowSize(),
      aspect: pictureAspect(),
      rest: subtitleRest(),
      controls,
      middle: middleShown() ? u(BIG_BUTTON) : 0,
      size: subtitleFit(windowSize(), pictureAspect(), safe().x, 0, "").size,
      gap: u(12),
    });
    return bottom > subtitleRest() + 0.5 ? bottom : 0;
  };
  /** The film's own subtitles (mpv draws them) in the box our overlay has: how far up and its
   * sides, as shares of the picture's height (mpv's margins follow the picture), and how much
   * larger than mpv's 5 % of it (no smaller than our overlay's least). */
  const filmSubtitles = () => {
    const fit = subtitleFit(windowSize(), pictureAspect(), safe().x, 0, "");
    const scale = subtitleScale(windowSize(), pictureAspect());
    // mpv scales its margins with the subtitles (`sub-scale`): they are given before it.
    const h = Math.max(1, fit.frame) * scale;
    return { lift: subtitlesAbove() / h, sides: fit.side / h, scale };
  };
  // Audio and Subtitles: what the core says the video and the release have.
  const { embedded, menu, cue, choose } = playerTracks();
  /** The panel's releases: the short list, as the film's page has it (one of each quality, and
   * the one playing), so a quality shows once. */
  const shortReleases = computed(() => tracks().releases.filter((r) => r.top || r.selected));
  const columns = computed(() => [menu().audio.length, menu().subtitles.length, shortReleases().length]);
  /** The lists the panel shows: Release only when there are releases (a saved film has none). */
  const lists = () => (shortReleases().length > 0 ? 3 : 2);
  /** Row `i` of list `col` is the chosen one: the release picked here, else what the core says. */
  const isSelected = (col: number, i: number, fromCore: boolean) => {
    const p = col === 2 ? picked()[col] : undefined;
    return p != null ? p === i : fromCore;
  };
  const pick = (col: number, row: number) => {
    const option = col === 0 ? menu().audio[row] : col === 1 ? menu().subtitles[row] : undefined;
    if (col === 2) picked.set({ ...picked(), [col]: row });
    else if (option && option.kind !== "original") void choose(option.key).catch((e) => console.warn("tracks", e));
  };

  // Up next: the core says when and what (near the end of an episode).
  const next = computed<Episode | null>(() => {
    const w = what();
    // Only once this episode plays: until then position and duration may still be the last
    // one's, near its end, and the card offered the episode after this one at once.
    return w && started() ? JSON.parse(Catalog.upNext(w.id, playSecond(), duration())) : null;
  });
  const dismissed = signal(false);
  const card = computed(() => next() != null && !dismissed());
  // Another episode (Up next, the Episodes panel) in the same player: it plays, its Up next
  // comes, the release picked for the last one is not its, and the controls show a moment (as
  // they do when a player opens).
  let playingId = untracked(what)?.id;
  effect(() => {
    const id = what()?.id;
    if (id == null || id === playingId) return;
    playingId = id;
    untracked(() => {
      paused.set(false);
      dismissed.set(false);
      picked.set({});
      poke();
    });
  });
  // Up next takes the keys and the screen: the panels and sheets close under it.
  effect(() => {
    if (card()) untracked(() => (panel.set(false), episodesOpen.set(false)));
  });
  const cardButton = signal(0);
  const countdown = signal(UP_NEXT_MS);
  let tick: ReturnType<typeof setInterval> | undefined;
  const playNext = () => {
    const n = next();
    const w = what();
    if (n && w) play({ id: n.id, season: n.season, episode: n.number, title: w.title });
  };
  effect(() => {
    clearInterval(tick);
    if (!card()) return;
    countdown.set(UP_NEXT_MS);
    cardButton.set(0);
    tick = setInterval(() => {
      countdown.set(Math.max(countdown() - 100, 0));
      if (countdown() === 0) {
        clearInterval(tick);
        playNext();
      }
    }, 100);
  });
  cleanup(() => clearInterval(tick));

  /** A seek on its way (the core fetches the place, then the view goes there): the loader
   * shows, and the view's times are the old place's, so the scrubber keeps the target and the
   * next press counts from it. */
  const seekPending = signal(false);
  /** The loader for a seek: only once it has taken `STALL_MS` (a seek into what is downloaded
   * is there before that, and a loader would only flicker). */
  const seekSlow = signal(false);
  let seekSlowTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(seekSlowTimer));
  const seekStarted = () => {
    seekPending.set(true);
    clearTimeout(seekSlowTimer);
    seekSlowTimer = setTimeout(() => seekSlow.set(seekPending()), STALL_MS);
  };
  const seekOver = () => {
    seekPending.set(false);
    clearTimeout(seekSlowTimer);
    seekSlow.set(false);
  };
  // The overlay hides on its own only while the film plays (not paused,
  // not buffering as `onBuffer` says, on a phone no seek waiting either: its waiting line is in
  // the controls), the panel is closed and no slider is held.
  /** What the swipe down to close moves (nothing is drawn by it): it makes the player's pan
   * vertical, so it never takes a sideways drag from the scrubber. */
  const closeDrag = createAnimatedValue(0);
  /** A finger or the mouse holds the scrubber or the volume. */
  const held = signal(false);
  const holding = (on: boolean) => {
    held.set(on);
    if (!on) poke();
  };
  const mayHide = () => started() && !paused() && !buffering() && !(PHONE() && seekSlow()) && !error() && !panel() && !episodesOpen() && !held();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (mayHide()) hide(); }, OVERLAY_MS);
  };
  /** Hidden, the remote is back on the scrubber: Left/Right seek. */
  const hide = () => {
    clearTimeout(hideTimer);
    overlay.set(false);
    panel.set(false);
    row.set("scrubber");
    button.set(PLAY_BUTTON);
  };
  /** Any input: show the overlay and count the quiet time again. */
  const poke = () => {
    overlay.set(true);
    scheduleHide();
  };
  // Playing again (unpaused, buffered, loaded): start counting.
  effect(() => { if (mayHide()) scheduleHide(); });
  cleanup(() => clearTimeout(hideTimer));

  const seekTo = (seconds: number) => {
    const d = duration();
    surface?.seek(Math.max(0, d > 0 ? Math.min(seconds, d) : seconds));
  };
  /** Where the arrows have moved the scrubber, not sent yet (null: none). Presses and a held
   * key's repeats only move it; the player seeks once they rest (`SCRUB_IDLE_MS`): a TV's
   * AVPlay takes seconds a seek, and one per press piled them up. */
  const scrubTo = signal<number | null>(null);
  let scrubTimer: ReturnType<typeof setTimeout> | undefined;
  let scrubSteps = 0;
  let lastScrub = 0;
  cleanup(() => clearTimeout(scrubTimer));
  /** Where a drag on the scrubber is, not sent yet (null: none): the video seeks once, on release. */
  const dragTo = signal<number | null>(null);
  /** Where the scrubber and the times show: a drag's or the arrows' target while they move it. */
  const shown = () => dragTo() ?? scrubTo() ?? position();
  const scrubBy = (dir: 1 | -1) => {
    // A drag on the scrubber has it: the arrows wait for the release.
    if (held()) return;
    const now = performance.now();
    scrubSteps = now - lastScrub < SCRUB_HOLD_MS ? scrubSteps + 1 : 0;
    lastScrub = now;
    const step = scrubSteps >= SCRUB_FASTER[1] ? 60 : scrubSteps >= SCRUB_FASTER[0] ? 30 : SEEK_S;
    const d = duration();
    const to = Math.max(0, Math.min(shown() + dir * step, d > 0 ? d : Infinity));
    scrubTo.set(to);
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => {
      scrubTo.set(null);
      seekTo(to);
    }, SCRUB_IDLE_MS);
  };
  /** A seek at once (a click on the scrubber, a drag let go): what the arrows were moving goes. */
  const seekNow = (seconds: number) => {
    clearTimeout(scrubTimer);
    scrubTo.set(null);
    dragTo.set(null);
    seekTo(seconds);
  };
  /** The whole seconds of the place playing and of the place shown: what asks the core
   * (Up next, the times' words) changes once a second, not with every report or press. */
  const playSecond = signal(0);
  const shownSecond = signal(0);
  effect(() => {
    const p = Math.floor(position());
    if (p !== untracked(playSecond)) playSecond.set(p);
  });
  effect(() => {
    const p = Math.floor(shown());
    if (p !== untracked(shownSecond)) shownSecond.set(p);
  });
  const togglePause = () => paused.set(!paused());
  const openPanel = () => {
    panel.set(true);
    panelCol.set(0);
    panelRow.set(0);
  };
  const run = (id: ButtonId) => {
    if (id === "play") togglePause();
    else if (id === "tracks") (episodesOpen.set(false), panel() ? panel.set(false) : openPanel());
    else if (id === "episodes") (panel.set(false), episodesOpen.set(!episodesOpen()));
    else if (id === "fullscreen") setFullscreen(!fullscreen());
    else if (id === "rotate") turn();
    else scrubBy(id === "back" ? -1 : 1);
  };
  const movePanel = (dc: number, dr: number) => {
    const col = Math.min(Math.max(panelCol() + dc, 0), lists() - 1);
    panelCol.set(col);
    panelRow.set(Math.min(Math.max(dc ? 0 : panelRow() + dr, 0), Math.max(columns()[col] - 1, 0)));
  };

  /** A key: wakes the overlay; `act` runs when the film is there to act on.
   * While the Up next card is up, `onCard` runs instead. */
  const key = (act: (wasShown: boolean) => void, onCard?: () => void) => () => {
    if (card()) return onCard?.();
    const wasShown = overlay();
    poke();
    if (started()) act(wasShown);
  };
  keymap.bind(
    {
      left: key(
        () => {
          if (panel()) movePanel(-1, 0);
          else if (row() === "buttons") button.set(Math.max(button() - 1, 0));
          else scrubBy(-1);
        },
        () => cardButton.set(0),
      ),
      right: key(
        () => {
          if (panel()) movePanel(1, 0);
          else if (row() === "buttons") button.set(Math.min(button() + 1, buttons.length - 1));
          else scrubBy(1);
        },
        () => cardButton.set(1),
      ),
    },
    { repeat: true },
  );
  // F: full screen, as in other players.
  if (caps.fullscreen) keymap.bind({ f: () => setFullscreen(!fullscreen()) });
  if (volumeShown) keymap.bind({ m: () => (toggleMute(), poke()) });
  keymap.bind({
    up: key((shown) => (panel() ? movePanel(0, -1) : shown && row.set("scrubber"))),
    down: key((shown) => (panel() ? movePanel(0, 1) : shown && row.set("buttons"))),
    space: key(togglePause),
    enter: key(
      (shown) => {
        if (panel()) pick(panelCol(), panelRow());
        else if (shown && row() === "buttons") run(buttons[button()]);
        else togglePause();
      },
      () => (cardButton() === 0 ? playNext() : dismissed.set(true)),
    ),
  });
  // Back, in this order: the Up next card, the tracks panel, the controls (a
  // TV's: restarting a torrent is slow), full screen, the player.
  onBack(() => {
    if (card()) dismissed.set(true);
    else if (panel()) panel.set(false);
    // On a problem the stage covers everything: Back leaves at once.
    else if (caps.remote && started() && overlay() && !failed()) hide();
    // A window that fills the screen is left first (as Escape does in macOS apps).
    else if (fullscreen()) setFullscreen(false);
    else leave();
    return true;
  });

  /** What cannot play, with what to do; null while it can. */
  const problem = (): StageLine | null => {
    const s = core();
    if (s.phase === "no_source") return { text: t("player.no_source"), hint: t("player.no_source_hint") };
    if (s.phase === "not_in_release") return { text: t("player.not_in_release"), hint: t("player.not_in_release_hint") };
    if (s.phase === "unsupported") return { text: t(`compat.${s.reason}`), hint: "" };
    if (s.phase === "no_space")
      return {
        text: s.free == null
          ? t("player.no_space_unknown", { needed: Fmt.size(s.needed) })
          : t("player.no_space", { needed: Fmt.size(s.needed), free: Fmt.size(s.free) }),
        hint: t("player.no_space_hint"),
      };
    if (s.phase === "failed") return { text: t("player.failed", { message: s.message }), hint: t("player.failed_hint") };
    const e = error();
    // The video view could not start (the mpv view made no render context): another release
    // plays no better.
    if (e?.code === "view") return { text: t("player.view_failed"), hint: t("player.view_failed_hint") };
    if (e) return { text: t("player.failed", { message: e.message }), hint: t("player.failed_hint") };
    return null;
  };
  const failed = () => problem() != null || lowSpace();
  /** The stage covers the screen until the first frame, and on a problem. */
  const staged = () => !started() || problem() != null;
  /** The stage's calm line: what the engine is doing now. */
  const stageLine = (): StageLine => {
    const p = problem();
    if (p) return p;
    const s = core();
    if (s.phase === "resolving") return { text: t(`player.stage.${s.stage ?? "finding"}`), hint: null };
    if (s.phase !== "ready" || loaded() || s.stage === "starting" || s.stage == null) return { text: t("player.stage.starting"), hint: null };
    if (s.stage === "fetching") return { text: t("player.stage.fetching", { percent: s.start ?? 0 }), hint: null };
    return s.found
      ? { text: t(`player.stage.found.${s.found === 1 ? "one" : "other"}`, { count: s.found }), hint: null }
      : { text: t("player.stage.connecting"), hint: null };
  };
  /** The bar under it: the film's start coming in; full once the player has it. */
  const stageProgress = () => {
    if (problem()) return null;
    const s = core();
    return s.phase !== "ready" ? 0 : loaded() ? 100 : (s.start ?? 0);
  };
  /** The top-left line while the overlay is up: only running out of space. */
  const status = () => (lowSpace() ? t("player.low_space") : "");
  // The device ran out of space while playing: stop where we are, keep the overlay up.
  effect(() => { if (lowSpace()) { paused.set(true); poke(); } });
  const streaming = () => {
    const s = core();
    if (s.phase !== "ready") return "";
    const speed = Fmt.speed(s.speed);
    return s.peers != null ? t("player.streaming_from", { speed, count: s.peers }) : t("player.streaming", { speed });
  };
  /** The stage's line under the bar: once someone is connected. */
  const stageMeta = () => {
    const s = core();
    return streamDetails() && s.phase === "ready" && !problem() && (s.peers ?? 0) > 0 ? streaming() : "";
  };
  /** A stall or a slow seek while playing: waiting, and how fast the stream comes when the
   * stream's details are on (Settings). What is ready ahead shows on the scrubber. */
  const waitingText = () => {
    const s = core();
    const words = t("player.waiting");
    return streamDetails() && s.phase === "ready" ? `${words} · ${Fmt.speed(s.speed)}` : words;
  };
  /** The waiting line shows: a stall or a slow seek while the film plays. On a phone it is in
   * the controls' bottom row, between the times (Play is at the picture's middle); elsewhere a
   * note at the middle. */
  const waiting = () => started() && !failed() && (buffering() || seekSlow());
  /** A stall shows the controls: the scrubber has what is ready, and Play and Back are at hand;
   * a phone's for a slow seek too, as its waiting line is in them. */
  effect(() => { if (started() && (buffering() || (PHONE() && seekSlow()))) untracked(poke); });
  const aheadText = () => {
    if (!timeline().ranges.length || duration() <= 0) return "";
    const m = Math.floor(timeline().ahead / 60);
    return m >= 1 ? t("player.ready_ahead", { minutes: m }) : t("player.ready_ahead_short");
  };
  /** Under the title: the episode, or the release that plays. */
  const subtitle = () => {
    const w = what();
    if (!w) return "";
    if (w.season != null && w.episode != null)
      return `${episodeCode(w.season, w.episode)} · ${episodeText(w.title.id, w.season, w.episode, "title")}`;
    const r = tracks().releases.find((x) => x.selected);
    return r ? `${r.quality} ${r.source}` : "";
  };
  const label = (id: ButtonId) =>
    id === "play" ? (paused() ? t("player.play") : t("player.pause"))
    : id === "back" ? t("player.back_10")
    : id === "forward" ? t("player.forward_10")
    : id === "fullscreen" ? (fullscreen() ? t("player.exit_fullscreen") : t("player.fullscreen"))
    : id === "rotate" ? t("player.rotate")
    : id === "episodes" ? t("player.episodes")
    : t("player.tracks");
  const icon = (id: ButtonId): ImageAsset =>
    id === "play" ? (paused() ? playIcon : pauseIcon) : id === "back" ? rewindIcon : id === "forward" ? forwardIcon
    : id === "fullscreen" ? (fullscreen() ? fullscreenExitIcon : fullscreenIcon)
    : id === "rotate" ? rotateIcon
    : id === "episodes" ? episodesIcon : tracksIcon;

  return (
    <Pressable feedback="none"
      testID="player"
      // A backdrop that wakes the controls, not one element for screen readers: as one (it hears
      // presses) it hid every control inside it from VoiceOver.
      accessible={false}
      style={{ flex: 1, backgroundColor: screenBackground() }}
      onMouseMove={() => {
        if (!card()) poke();
      }}
      onPress={() => {
        if (card()) return;
        poke();
      }}

      // Touch: a swipe down closes the player, as a full-screen cover does.
      // Not while a sheet is open: its own swipe (or its list's scroll) closes only the sheet.
      // Up and down only: sideways drags are the scrubber's.
      pan={{ y: closeDrag }}
      onPanEnd={(e) => {
        closeDrag.set(0);
        if (caps.touch && !panel() && !episodesOpen() && !e.cancelled && (e.translation.y > 120 || e.velocity.y > 800)) leave();
      }}
      focusable={false}
    >
      <If when={ready()}>
        <VideoSurface
          surfaceRef={(r) => (surface = r)}
          src={url()}
          paused={paused() || leaving()}
          volume={leaving() ? 0 : playVolume()}
          // The film's own subtitles (mpv draws them) rise above the controls while they show,
          // clear of the middle buttons, and sit at the picture held upright.
          subtitleLift={filmSubtitles().lift}
          subtitleSides={filmSubtitles().sides}
          subtitleScale={filmSubtitles().scale}
          audioLanguages={menu().apply.audioLanguages ?? ""}
          audioTrack={menu().apply.audio}
          subtitleTrack={menu().apply.subtitle}
          onTracks={(json) => embedded.set(json)}
          progressUpdateInterval={250}
          onLoad={(e) => {
            loaded.set(true);
            turnForPicture(e.width, e.height);
            pictureAspect.set(e.width && e.height ? e.width / e.height : undefined);
            duration.set(e.duration);
            resumeTo = 0;
            // Resume: once, where the viewer stopped.
            if (startAt() > 0) { resumeTo = startAt(); seekTo(startAt()); startAt.set(0); }
          }}
          onProgress={(e) => {
            // The last file's progress, still coming after the new one was asked for: not this one's.
            if (!loaded()) return;
            // Still the old place's time while a seek is on its way: the scrubber keeps the target.
            if (!seekPending()) position.set(e.currentTime);
            // What the view holds ahead is the old place's while a seek is on its way: not
            // drawn after the new one as ready.
            cachedAhead.set(seekPending() ? 0 : (e.cached ?? 0));
            readAt.set({ byte: e.readAt ?? 0, time: e.readTime ?? 0 });
            if (e.duration > 0) duration.set(e.duration);
            // The first frame from where it should start: the film plays.
            if (!started() && loaded() && !buffering() && e.currentTime >= resumeTo - 1) {
              started.set(true);
              firstFrame();
            }
          }}
          onBuffer={(e) => {
            clearTimeout(stallTimer);
            if (!e.isBuffering) return buffering.set(false);
            // A seek inside what is downloaded ends at once: no note for it.
            stallTimer = setTimeout(() => buffering.set(true), STALL_MS);
          }}
          onEnd={() => { paused.set(true); poke(); }}
          onSeeking={(to) => { position.set(to); cachedAhead.set(0); seekStarted(); }}
          // The seek is over (AVPlay lands on a keyframe, maybe seconds before the target): its times stand.
          onSeeked={seekOver}
          onError={(e) => { seekOver(); error.set(e); }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </If>

      {/* The picture's own layer, under the controls: a double click on it is full screen and
          back, as in other players (on the controls it is not). Told by the presses going down
          (each one comes, with its count), not by onPress (a quick second click may bring none). */}
      <If when={caps.fullscreen}>
        <Pressable feedback="none"
          testID="picture"
          accessible={false}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => !card() && poke()}
          onPressDown={(e) => {
            if (!card() && e && isDoubleClick(e)) setFullscreen(!fullscreen());
          }}
        />
      </If>

      <SubtitleOverlay text={cue} above={subtitlesAbove} aspect={pictureAspect} />

      <If when={!PHONE() && waiting()}>
        <BufferingNote text={waitingText} />
      </If>

      <If when={staged() ? what() : null}>
        {(w) => (
          <PlayerStage
            item={() => w().title}
            subtitle={subtitle}
            line={stageLine}
            progress={stageProgress}
            meta={stageMeta}
          />
        )}
      </If>
      {/* A desktop's Back keeps the window bar's slot (at the corner in full screen). */}
      <If when={caps.windowBar && (staged() || (overlay() && !card()))}>
        <View style={barBackSlot(fullscreen())}>
          <BarBack
            onPress={leave}
            enabled={() => true}
            tip={() => (what() ? t("nav.back_to", { page: titleText(what()!.title) }) : t("player.back"))}
            background={PLAYER_BACK_FILL}
          />
        </View>
      </If>
      {/* A TV has no Back on screen: the remote's Back key is it. */}
      <If when={staged() && caps.touch}>
        <View style={{ position: "absolute", ...touchCorner() }}>
          <CloseButton onPress={leave} />
        </View>
      </If>

      <If when={overlay() && !card() && !staged()}>
        {/* Shade: dark at the top and the bottom, the picture clear between. */}
        <View
          style={{
            pointerEvents: "none", position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage:
              `linear-gradient(180deg, ${alpha(colors.ink(), 0.7)} 0%, ${alpha(colors.ink(), 0)} 20%), ` +
              `linear-gradient(0deg, ${alpha(colors.ink(), 0.95)} 12%, ${alpha(colors.ink(), 0.55)} 30%, ${alpha(colors.ink(), 0)} 48%)`,
          }}
        />
        {/* Top: back, title, the episode or release, what the engine is doing. */}
        <View style={topRowStyle(fullscreen())}>
          <If when={caps.touch}>
            <CloseButton onPress={leave} />
          </If>
          {/* The title's first line centred on the ✕ (a TV's at the safe area's corner); more lines go below. */}
          <View style={{ gap: u(4), flexShrink: 1, marginTop: caps.touch ? (CLOSE() - u(34) * 1.25) / 2 : 0 }}>
            <Text style={{ fontFamily: font, fontSize: ts(34), fontWeight: 600, color: colors.snow() }}>
              {what() ? titleText(what()!.title) : ""}
            </Text>
            <If when={subtitle() !== ""}>
              <Text style={{ ...type.meta(), color: colors.ash() }}>{subtitle()}</Text>
            </If>
            <If when={status() !== ""}>
              <Text style={{ ...type.meta(), color: colors.soft() }}>{status()}</Text>
            </If>
          </View>
          {/* A phone's secondary buttons, at the right, centred on the ✕'s line. */}
          <If when={ready() && topButtons.length > 0}>
            <View testID="player-top-buttons" style={topButtonsStyle()}>
              <Each of={topButtons} key="index">
                {(id) => (
                  <RoundButton
                    icon={() => icon(id())}
                    label={() => label(id())}
                    size={BUTTON}
                    focused={() => row() === "buttons" && buttons[button()] === id() && !panel()}
                    selected={() => (id() === "tracks" && panel()) || (id() === "episodes" && episodesOpen())}
                    onPress={() => { poke(); button.set(buttons.indexOf(id())); run(id()); }}
                  />
                )}
              </Each>
            </View>
          </If>
        </View>

        <If when={episodesOpen() ? what() : null}>
          {(w) => (
            <>
              {/* A tap beside the panel closes it, as the tracks panel's does. */}
              <Pressable feedback="none" role="button" accessibilityLabel={t("player.close_episodes")} onPress={() => episodesOpen.set(false)} style={panelBackdrop} />
              <PlayerEpisodes
                bottom={() => controlsHeight() + controlsBottom() + u(24)}
                show={() => w().title}
                season={() => episodeOf()?.season ?? w().season ?? 1}
                episode={() => episodeOf()?.episode ?? w().episode ?? 1}
                onPlay={(e) => {
                  // The show's title first: closing the panel drops `w`.
                  const title = w().title;
                  episodesOpen.set(false);
                  play({ id: e.id, season: e.season, episode: e.number, title });
                }}
                onClose={() => episodesOpen.set(false)}
              />
            </>
          )}
        </If>
        <If when={panel() && SHEETS()}>
          <TracksSheet
            lists={lists}
            col={panelCol}
            onCol={(col) => { poke(); panelCol.set(col); panelRow.set(0); }}
            rows={() => trackRows(panelCol(), menu().audio, menu().subtitles, shortReleases())}
            focused={(i) => panelRow() === i}
            isSelected={(i, fromCore) => isSelected(panelCol(), i, fromCore)}
            onPick={(i) => { poke(); panelRow.set(i); pick(panelCol(), i); }}
            onClose={() => panel.set(false)}
          />
        </If>
        <If when={panel() && !SHEETS()}>
          {/* A tap beside the panel closes it, as a sheet's does. */}
          <Pressable feedback="none" role="button" accessibilityLabel={t("player.close_tracks")} onPress={() => panel.set(false)} style={panelBackdrop} />
          <TracksPanel
            lists={lists}
            bottom={() => controlsHeight() + controlsBottom() + u(24)}
            rows={(col) => trackRows(col, menu().audio, menu().subtitles, shortReleases())}
            isSelected={isSelected}
            focused={(col, i) => panelCol() === col && panelRow() === i}
            onPick={(col, i) => { poke(); panelCol.set(col); panelRow.set(i); pick(col, i); }}
            onClose={() => panel.set(false)}
          />
        </If>

        {/* A phone's middle: −10 s, Play (larger), +10 s over the picture's centre. */}
        <If when={middleShown()}>
          <View testID="player-middle" style={middleStyle()}>
            <Each of={middleButtons} key="index">
              {(id) => (
                <RoundButton
                  icon={() => icon(id())}
                  label={() => label(id())}
                  size={id() === "play" ? BIG_BUTTON : BUTTON}
                  focused={() => row() === "buttons" && buttons[button()] === id() && !panel()}
                  selected={() => false}
                  onPress={() => { poke(); button.set(buttons.indexOf(id())); run(id()); }}
                />
              )}
            </Each>
          </View>
        </If>

        {/* Bottom: engine line, scrubber, times, buttons. */}
        <If when={ready()}>
          <View testID="player-bottom" onLayout={(e) => controlsHeight.set(e.bounds.size.height)} style={{ position: "absolute", left: safe().x, right: safe().x, bottom: controlsBottom() }}>
            <If when={streamDetails()}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", minHeight: u(32) }}>
              <If when={aheadText() !== ""}>
                <Text style={{ fontFamily: font, fontSize: ts(24), fontWeight: 600, color: colors.snow() }}>{aheadText()}</Text>
                <Text style={{ fontFamily: font, fontSize: ts(24), color: colors.ash() }}>{" · "}</Text>
              </If>
              <Text style={{ fontFamily: font, fontSize: ts(24), color: colors.soft() }}>{streaming()}</Text>
            </View>
            </If>
            <Scrubber
              focused={() => row() === "scrubber" && !panel()}
              position={shown}
              duration={duration}
              ranges={() => timeline().ranges}
              valueText={() => `${Fmt.position(shownSecond())} / ${Fmt.position(Math.ceil(duration()))}`}
              onDrag={(s) => dragTo.set(s)}
              onHold={holding}
              onStep={scrubBy}
              onSeek={(s) => { poke(); seekNow(s); }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: u(16) }}>
              <View onLayout={PHONE() ? (e) => timeWidths.set([e.bounds.size.width, timeWidths()[1]]) : undefined}>
                <Text style={timeText(colors.snow())}>{Fmt.position(shownSecond())}</Text>
              </View>
              <View onLayout={PHONE() ? (e) => timeWidths.set([timeWidths()[0], e.bounds.size.width]) : undefined}>
                <Text style={timeText(colors.ash())}>
                  {duration() > 0 ? t("player.left", { time: Fmt.position(Math.max(Math.ceil(duration()) - shownSecond(), 0)) }) : ""}
                </Text>
              </View>
              {/* A phone's waiting line, at the row's middle, clear of the wider time. */}
              <If when={PHONE() && waiting()}>
                <WaitingLine text={waitingText} side={() => Math.max(...timeWidths()) + u(16)} style={() => timeText(colors.soft())} />
              </If>
            </View>
            <If when={bottomButtons.length > 0 || volumeShown}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: u(14), marginTop: u(26) }}>
              {/* On the right: the volume (computers). */}
              <If when={volumeShown}>
                <View style={{ position: "absolute", right: 0 }}>
                  <PlayerVolume onUse={poke} onHold={holding} />
                </View>
              </If>
              <Each of={bottomButtons} key="index">
                {(id, i) => (
                  <View style={{ marginLeft: id() === rightFrom ? "auto" : id() === "tracks" && i() > 0 ? u(22) : 0 }}>
                    <RoundButton
                      icon={() => icon(id())}
                      label={() => label(id())}
                      size={BUTTON}
                      focused={() => row() === "buttons" && buttons[button()] === id() && !panel()}
                      selected={() => (id() === "tracks" && panel()) || (id() === "episodes" && episodesOpen())}
                      onPress={() => { poke(); button.set(buttons.indexOf(id())); run(id()); }}
                    />
                  </View>
                )}
              </Each>
            </View>
            </If>
          </View>
        </If>
      </If>

      <If when={card() ? next() : null}>
        {(n) => (
          <UpNext
            episode={n}
            focused={cardButton}
            countdown={countdown}
            onPlay={playNext}
            onCredits={() => dismissed.set(true)}
          />
        )}
      </If>
    </Pressable>
  );
}

/** Two presses this close in time (ms) and place (points) are a double click. */
const DOUBLE_MS = 400;
const DOUBLE_SLOP = 8;
let lastPress: { at: number; x: number; y: number } | null = null;

/** A double click: the platform's count where it reports one (macOS), else two presses close in
 * time and place (Windows reports every click as the first). */
function isDoubleClick(e: { clickCount?: number; pagePosition: { x: number; y: number } }): boolean {
  const now = Date.now();
  const prev = lastPress;
  lastPress = { at: now, x: e.pagePosition.x, y: e.pagePosition.y };
  if ((e.clickCount ?? 1) >= 2) return (lastPress = null), true;
  if (prev && now - prev.at <= DOUBLE_MS && Math.abs(prev.x - e.pagePosition.x) <= DOUBLE_SLOP && Math.abs(prev.y - e.pagePosition.y) <= DOUBLE_SLOP) {
    lastPress = null;
    return true;
  }
  return false;
}

/** Watched (snow), ready (snow 45%) and not loaded yet (snow 16%) along the
 * film; a press seeks to where it landed, a drag where it is let go. */
function Scrubber(props: {
  focused: () => boolean;
  position: () => number;
  duration: () => number;
  /** Ready stretches from the core, [from, to] in 0..1. */
  ranges: () => [number, number][];
  valueText: () => string;
  /** While held: the time under the thumb (null: let go with no seek). */
  onDrag: (seconds: number | null) => void;
  onHold: (held: boolean) => void;
  onStep: (dir: 1 | -1) => void;
  onSeek: (seconds: number) => void;
}) {
  const at = () => (props.duration() > 0 ? Math.min(props.position() / props.duration(), 1) : 0);
  const ranges = computed(() => props.ranges().map(([from, to]) => ({ from, to })));
  const bar = u(8);
  const seconds = (f: number) => f * props.duration();
  return (
    <TrackSlider
      testID="scrubber"
      accessibilityLabel={t("player.position")}
      valueText={props.valueText}
      value={at}
      // Nothing to seek in before the length is known.
      onScrub={(f) => props.duration() > 0 && props.onDrag(f == null ? null : seconds(f))}
      onCommit={(f) => props.duration() > 0 && props.onSeek(seconds(f))}
      onHold={props.onHold}
      onStep={props.onStep}
      focused={props.focused}
      track={bar}
      thumb={u(26)}
      empty={alpha(colors.snow(), 0.16)}
      height={u(36)}
      style={{ marginTop: u(10) }}
    >
      {(width) => (
        <Each of={ranges()} key={(r) => r.from}>
          {(r) => (
            <View
              style={{
                position: "absolute", top: 0, bottom: 0, borderRadius: bar / 2, borderCurve: "continuous",
                left: r().from * width(), width: (r().to - r().from) * width(),
                backgroundColor: alpha(colors.snow(), 0.45),
              }}
            />
          )}
        </Each>
      )}
    </TrackSlider>
  );
}

/** A phone's top-right buttons: pushed to the right edge, centred on the ✕'s line. */
const topButtonsStyle = (): ViewStyle => ({
  marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: u(14), marginTop: (CLOSE() - u(BUTTON)) / 2,
});

/** A phone's middle row, centred on the picture; presses beside its buttons reach the picture. */
const middleStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "box-none",
  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: u(56),
});

/** A round player button: its icon only (the label is for screen readers). */
function RoundButton(props: {
  icon: () => ImageAsset;
  label: () => string;
  /** Its diameter, TV pixels (times the phone's controls). */
  size: number;
  focused: () => boolean;
  selected: () => boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <Pressable
        role="button"
        accessibilityLabel={props.label()}
        onPress={props.onPress}
        hoverStyle={{ backgroundColor: colors.control() }}
        style={{
          width: u(props.size), height: u(props.size), borderRadius: 999, borderCurve: "continuous",
          alignItems: "center", justifyContent: "center",
          backgroundColor: props.selected() ? colors.control() : alpha(colors.raise(), 0.85),
          ...focusRing(props.focused()),
        }}
      >
        <Image src={props.icon()} style={{ width: u(props.size / 2), height: u(props.size / 2), tintColor: colors.snow() }} />
      </Pressable>
    </View>
  );
}

/** Audio, Subtitles and Release in one dark panel. */
/** Under an open panel, over the controls: a press beside the panel closes it. */
const panelBackdrop: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 };

/** ✕ in the tracks panel's corner (touch). */
const panelCloseStyle = (): ViewStyle => ({
  position: "absolute", top: u(14), right: u(14), width: u(56), height: u(56), borderRadius: u(28),
  alignItems: "center", justifyContent: "center", backgroundColor: colors.raise(),
});

function TracksPanel(props: {
  /** How many lists show: Audio and Subtitles, and Release when there are releases. */
  lists: () => number;
  rows: (col: number) => TrackRow[];
  isSelected: (col: number, i: number, fromCore: boolean) => boolean;
  focused: (col: number, i: number) => boolean;
  onPick: (col: number, i: number) => void;
  onClose: () => void;
  /** Where it ends from the player's bottom: above the controls. */
  bottom: () => number;
}) {
  /** The focus fill shows only while the keys drive (as the ring does everywhere); a tap only picks. */
  const lit = (col: number, i: number) => props.focused(col, i) && showFocus();
  const isSelected = props.isSelected;
  const column = (col: number, heading: string, options: () => TrackRow[]) => (
    <View style={{ flex: col === 2 ? 1.25 : 1, paddingHorizontal: u(18), borderLeftWidth: col > 0 ? 1 : 0, borderColor: colors.raise() }}>
      {/* On touch the rows start under the panel's ✕ (top right), clear of the release's check. */}
      <Text style={{ fontFamily: font, fontSize: ts(21), fontWeight: 500, color: colors.ash(), marginLeft: u(16), marginBottom: caps.touch ? u(34) : u(10) }}>
        {heading}
      </Text>
      {/* A long list scrolls inside the panel. */}
      <Scroll style={{ flex: 1 }} scrollbar={false}>
      <Each of={options()} key="index">
        {(o, i) => (
          <Pressable feedback="row" haptic={!isSelected(col, i(), o().selected)}
            testID={o().id}
            role="button"
            accessibilityLabel={o().main}
            accessibilityState={{ selected: isSelected(col, i(), o().selected) }}
            onPress={() => props.onPick(col, i())}
            hoverStyle={{ backgroundColor: colors.card() }}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              minHeight: u(o().sub ? 74 : 60), paddingHorizontal: u(16), borderRadius: radius(), borderCurve: "continuous",
              // Rows in a panel sit close together, so focus is a fill, not the ring
              // (Direction 3: focused = snow fill with ink text; selected = card fill + check).
              backgroundColor: lit(col, i()) ? colors.snow() : isSelected(col, i(), o().selected) ? colors.card() : "transparent",
            }}
          >
            <View style={{ flexShrink: 1 }}>
              <Text style={{ ...type.label(), color: lit(col, i()) ? colors.ink() : isSelected(col, i(), o().selected) ? colors.snow() : colors.soft() }}>
                {o().main}
              </Text>
              <If when={o().sub}>
                <Text style={{ fontFamily: font, fontSize: ts(19), color: lit(col, i()) ? alpha(colors.ink(), 0.7) : colors.ash(), marginTop: u(2) }}>{o().sub}</Text>
              </If>
            </View>
            <If when={isSelected(col, i(), o().selected)}>
              <Icon src={() => checkIcon} size={24} color={() => (lit(col, i()) ? colors.ink() : colors.snow())} />
            </If>
          </Pressable>
        )}
      </Each>
      </Scroll>
    </View>
  );
  return (
    <View
      style={{
        // It ends above the controls (their height, `bottom`): it never covers the scrubber.
        position: "absolute", zIndex: 20, top: u(150), bottom: props.bottom(), right: safe().x, width: u(1020), maxWidth: "90%",
        flexDirection: "row", padding: u(26), borderRadius: radius() + u(26), borderCurve: "continuous", backgroundColor: colors.card(),
      }}
    >
      {column(0, trackHeadings()[0], () => props.rows(0))}
      {column(1, trackHeadings()[1], () => props.rows(1))}
      <If when={props.lists() > 2}>{column(2, trackHeadings()[2], () => props.rows(2))}</If>
      {/* Touch has no Back key on screen: ✕ closes the panel (a tap beside it does too). */}
      <If when={caps.touch}>
        <Pressable role="button" accessibilityLabel={t("player.close_tracks")} hitSlop={targetSlop(u(56))} onPress={props.onClose}
          style={panelCloseStyle()}>
          <View style={{ transform: "rotate(45deg)" }}>
            <Icon src={() => plusIcon} size={iconPt(15)} />
          </View>
        </Pressable>
      </If>
    </View>
  );
}

/** Near the end of an episode: the next one, Play now with its countdown,
 * and Watch credits. */
function UpNext(props: {
  episode: () => Episode;
  focused: () => number;
  countdown: () => number;
  onPlay: () => void;
  onCredits: () => void;
}) {
  const e = props.episode;
  const seconds = () => Math.ceil(props.countdown() / 1000);
  return (
    <View
      style={{
        // A phone's: at the controls' bottom, clear of the home indicator.
        position: "absolute", right: safe().x, bottom: PHONE() ? controlsBottom() : u(96), width: u(720), maxWidth: "90%",
        padding: u(22), borderRadius: radius() + u(22), borderCurve: "continuous", backgroundColor: alpha(colors.card(), 0.95),
        boxShadow: `0 ${u(24)}px ${u(60)}px ${alpha(colors.ink(), 0.6)}`,
      }}
    >
      <View style={{ flexDirection: "row", gap: u(22) }}>
        <View style={{ width: u(256), height: u(144), borderRadius: u(8), borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.raise() }}>
          <If when={e().thumb}>
            <Image src={e().thumb!} style={{ flex: 1, objectFit: "cover", objectPosition: "center 30%" }} />
          </If>
        </View>
        <View style={{ flex: 1, gap: u(6) }}>
          <Text style={{ fontFamily: font, fontSize: ts(21), color: colors.ash() }}>
            {t("player.next_episode", { code: episodeCode(e().season, e().number) })}
          </Text>
          <Text style={{ numberOfLines: 2, fontFamily: font, fontSize: ts(28), fontWeight: 600, color: colors.snow() }}>
            {e().title}
          </Text>
          <Text style={{ fontFamily: font, fontSize: ts(21), color: colors.ash() }}>{runtime(e().minutes)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: u(14), marginTop: u(22) }}>
        <Pressable
          role="button"
          accessibilityLabel={t("player.play_now")}
          onPress={props.onPlay}
          style={{
            flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: u(12),
            height: u(60), borderRadius: radius(), borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.snow(),
            ...focusRing(props.focused() === 0),
          }}
        >
          <Icon src={() => playIcon} size={22} color={colors.ink} />
          <Text style={{ ...type.label(), fontWeight: 600, color: colors.ink() }}>{t("player.play_now")}</Text>
          <Text style={{ ...type.small(), fontWeight: 500, color: colors.faint() }}>{t("player.in_seconds", { seconds: seconds() })}</Text>
          {/* The countdown: a thin bar along the bottom; full, the next episode plays. */}
          <View
            style={{
              position: "absolute", left: 0, bottom: 0, height: u(5),
              width: `${Math.round((1 - props.countdown() / UP_NEXT_MS) * 100)}%`,
              backgroundColor: alpha(colors.ink(), 0.55),
            }}
          />
        </Pressable>
        <Pressable
          role="button"
          accessibilityLabel={t("player.watch_credits")}
          onPress={props.onCredits}
          style={{
            flexDirection: "row", alignItems: "center", paddingHorizontal: u(26), height: u(60),
            borderRadius: radius(), borderCurve: "continuous", backgroundColor: colors.raise(),
            ...focusRing(props.focused() === 1),
          }}
        >
          <Text style={{ ...type.label(), fontWeight: 600, color: colors.snow() }}>{t("player.watch_credits")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
