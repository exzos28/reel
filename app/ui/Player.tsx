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
import { cleanup, computed, effect, Image, keymap, safeArea, Scroll, signal, Text, untracked, View, windowSize, type ImageAsset, type ViewStyle } from "nsh";
import { BufferingNote, PlayerStage, type StageLine } from "./PlayerStage";
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "./native";
import { episodeCode, episodeText, runtime, titleText, type Episode, type Release } from "./catalog";
import { Icon } from "./components";
import { rounded } from "./kit/shape";
import plusIcon from "./icons/plus.svg";
import { streamDetails } from "./preferences";
import { cachedAhead, duration, firstFrame, readAt, playing as what, play, position, startAt, status as core, stop, timeline } from "./playback";
import { alpha, colors, focusRing, font, iconPt, radius, safe, showFocus, targetSlop, ts, type, u } from "./theme";
import { chrome } from "./layout/chrome";
import { caps } from "./platform";
import { playVolume, PlayerVolume, toggleMute, volumeDragEnd, volumeDragMove, volumeShown } from "./PlayerVolume";
import { useFullscreen } from "./platform/window";
import { BarBack, barBackBox } from "./layout/WindowBar";
import { onBack } from "./nav";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { playerTracks, type TrackOption } from "./tracks";
import { VideoSurface, videoUnderUi, type SurfaceRef } from "./VideoSurface";
import playIcon from "./icons/play.svg";
import pauseIcon from "./icons/pause.svg";
import rewindIcon from "./icons/rewind.svg";
import forwardIcon from "./icons/forward.svg";
import tracksIcon from "./icons/tracks.svg";
import fullscreenIcon from "./icons/fullscreen.svg";
import fullscreenExitIcon from "./icons/fullscreen-exit.svg";
import episodesIcon from "./icons/episodes.svg";
import { PlayerEpisodes } from "./PlayerEpisodes";
import checkIcon from "./icons/check.svg";

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
/** A seek has arrived when the player's time is this near its target, s… */
const SEEK_NEAR_S = 3;
/** …or after this long anyway (it may land elsewhere, on a keyframe), ms. */
const SEEK_WAIT_MS = 12000;
/** How long a wait lasts before the buffering note shows, ms. */
const STALL_MS = 300;

type Row = "scrubber" | "buttons";
/** The desktop's Back over the picture: the bar's, on a dark fill. */
const PLAYER_BACK_FILL = "#2A2A2AD9";
/** Where it sits: the bar's Back slot, or (20, 12) in full screen. */
const barBackSlot = (full: boolean): ViewStyle => {
  const b = barBackBox(full);
  return { position: "absolute", top: b.top, left: b.left, zIndex: 3 };
};
/** Touch's ✕, points: 44 on a tablet at (24, 24), 40 on a phone at the
 * landscape safe area's left (x 62 beside a Dynamic Island). */
const CLOSE = chrome === "tablet" ? 44 : 40;
const touchCorner = () =>
  chrome === "tablet" ? { top: 24, left: 24 } : { top: Math.max(18, safeArea().top), left: Math.max(20, safeArea().left) };
const closeDisc = (): ViewStyle => ({
  width: CLOSE,
  height: CLOSE,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: PLAYER_BACK_FILL,
});

/** ✕ (touch): leaves the player. */
function CloseButton(props: { onPress: () => void }) {
  return (
    <View role="button" hitSlop={targetSlop(CLOSE)} accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeDisc()}>
      <View style={{ transform: "rotate(45deg)" }}>
        <Icon src={() => plusIcon} size={iconPt(17)} />
      </View>
    </View>
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

const BUTTONS = ["back", "play", "forward", "tracks", "episodes", "fullscreen"] as const;
type ButtonId = (typeof BUTTONS)[number];
const PLAY_BUTTON = 1;

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
    (b) => (b !== "fullscreen" || caps.fullscreen) && (b !== "episodes" || episodeOf() != null),
  );
  /** The show's episodes in a panel (a series only). */
  const episodesOpen = signal(false);
  /** The window fills the screen (desktops). Left as it was found when the player closes. */
  const { on: fullscreen, set: setFullscreen } = useFullscreen();

  // The tracks panel: three columns, the focus inside it while it is open.
  const panel = signal(false);
  const panelCol = signal(0);
  const panelRow = signal(0);
  const tracks = computed<Tracks>(() => JSON.parse(Catalog.tracks(what()?.id ?? "")));
  /** The release picked in the panel (shown; switching releases is the catalog's). */
  const picked = signal<Record<number, number>>({});
  /** The bottom controls' height: the subtitles sit above it while they show. */
  const controlsHeight = signal(0);
  // Audio and Subtitles: what the core says the video and the release have.
  const { embedded, menu, cue, choose } = playerTracks();
  /** The panel's releases: the short list, as the film's page has it (one of each quality, and
   * the one playing), so a quality shows once. */
  const shortReleases = computed(() => tracks().releases.filter((r) => r.top || r.selected));
  const columns = computed(() => [menu().audio.length, menu().subtitles.length, shortReleases().length]);
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

  // The overlay hides on its own only while the film plays (not paused,
  // not buffering as `onBuffer` says) and the panel is closed.
  const mayHide = () => started() && !paused() && !buffering() && !error() && !panel() && !episodesOpen();
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

  /** A seek on its way: where to and when it was asked. Until the player reports a time near
   * it, its times are the old place's (a TV's AVPlay takes seconds to get there), so the
   * scrubber keeps the target and the next press counts from it. */
  let seeking: { to: number; at: number } | null = null;
  const seekTo = (seconds: number) => {
    const d = duration();
    const to = Math.max(0, d > 0 ? Math.min(seconds, d) : seconds);
    position.set(to);
    seeking = { to, at: performance.now() };
    surface?.seek(to);
  };
  /** Where the arrows have moved the scrubber, not sent yet (null: none). Presses and a held
   * key's repeats only move it; the player seeks once they rest (`SCRUB_IDLE_MS`): a TV's
   * AVPlay takes seconds a seek, and one per press piled them up. */
  const scrubTo = signal<number | null>(null);
  let scrubTimer: ReturnType<typeof setTimeout> | undefined;
  let scrubSteps = 0;
  let lastScrub = 0;
  cleanup(() => clearTimeout(scrubTimer));
  /** Where the scrubber and the times show: the arrows' target while they move it. */
  const shown = () => scrubTo() ?? position();
  const scrubBy = (dir: 1 | -1) => {
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
  /** A seek at once (a click on the scrubber): what the arrows were moving goes. */
  const seekNow = (seconds: number) => {
    clearTimeout(scrubTimer);
    scrubTo.set(null);
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
    else scrubBy(id === "back" ? -1 : 1);
  };
  const movePanel = (dc: number, dr: number) => {
    const col = Math.min(Math.max(panelCol() + dc, 0), 2);
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
    else stop();
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
  /** A stall while playing: how much is ready ahead and how fast it comes. */
  const bufferingText = () => {
    if (!streamDetails()) return "";
    const s = core();
    const ahead = Math.floor(timeline().ahead);
    const first = ahead > 0 ? t("player.ahead_seconds", { seconds: ahead }) : t("player.buffering");
    if (s.phase !== "ready") return first;
    const speed = Fmt.speed(s.speed);
    return `${first} · ${s.peers != null ? t("player.rate_from", { speed, count: s.peers }) : speed}`;
  };
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
    : id === "episodes" ? t("player.episodes")
    : t("player.tracks");
  const icon = (id: ButtonId): ImageAsset =>
    id === "play" ? (paused() ? playIcon : pauseIcon) : id === "back" ? rewindIcon : id === "forward" ? forwardIcon
    : id === "fullscreen" ? (fullscreen() ? fullscreenExitIcon : fullscreenIcon)
    : id === "episodes" ? episodesIcon : tracksIcon;

  return (
    <View
      testID="player"
      style={{ flex: 1, backgroundColor: screenBackground() }}
      onMouseMove={(e) => {
        volumeDragMove(e.pagePosition.x, e.pressedButton != null);
        if (!card()) poke();
      }}
      onMouseUp={volumeDragEnd}
      onPress={() => {
        if (card()) return;
        poke();
      }}

      // Touch: a swipe down closes the player, as a full-screen cover does.
      onPanEnd={(e) => caps.touch && !e.cancelled && (e.translation.y > 120 || e.velocity.y > 800) && stop()}
      focusable={false}
    >
      <If when={ready()}>
        <VideoSurface
          surfaceRef={(r) => (surface = r)}
          src={url()}
          paused={paused()}
          volume={playVolume()}
          // The film's own subtitles (mpv draws them) rise above the controls while they show.
          subtitleLift={overlay() && !card() ? controlsHeight() / Math.max(1, windowSize().height) : 0}
          audioTrack={menu().apply.audio}
          subtitleTrack={menu().apply.subtitle}
          onTracks={(json) => embedded.set(json)}
          progressUpdateInterval={250}
          onLoad={(e) => {
            loaded.set(true);
            duration.set(e.duration);
            resumeTo = 0;
            // Resume: once, where the viewer stopped.
            if (startAt() > 0) { resumeTo = startAt(); seekTo(startAt()); startAt.set(0); }
          }}
          onProgress={(e) => {
            // The last file's progress, still coming after the new one was asked for: not this one's.
            if (!loaded()) return;
            // Still the old place's time while a seek is on its way: the scrubber keeps the target.
            if (seeking && (Math.abs(e.currentTime - seeking.to) <= SEEK_NEAR_S || performance.now() - seeking.at > SEEK_WAIT_MS)) seeking = null;
            if (!seeking) position.set(e.currentTime);
            cachedAhead.set(e.cached ?? 0);
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
          onError={(e) => error.set(e)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </If>

      {/* The picture's own layer, under the controls: a double click on it is full screen and
          back, as in other players (on the controls it is not). Told by the presses going down
          (each one comes, with its count), not by onPress (a quick second click may bring none). */}
      <If when={caps.fullscreen}>
        <View
          testID="picture"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => !card() && poke()}
          onPressDown={(e) => {
            if (!card() && e && isDoubleClick(e)) setFullscreen(!fullscreen());
          }}
        />
      </If>

      <SubtitleOverlay text={cue} lift={() => (overlay() && !card() ? controlsHeight() : 0)} />

      <If when={started() && !failed() && buffering()}>
        <BufferingNote text={bufferingText} />
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
            onPress={stop}
            enabled={() => true}
            tip={() => (what() ? t("nav.back_to", { page: titleText(what()!.title) }) : t("player.back"))}
            background={PLAYER_BACK_FILL}
          />
        </View>
      </If>
      {/* A TV has no Back on screen: the remote's Back key is it. */}
      <If when={staged() && caps.touch}>
        <View style={{ position: "absolute", ...touchCorner() }}>
          <CloseButton onPress={stop} />
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
            <CloseButton onPress={stop} />
          </If>
          {/* The title's first line centred on the ✕ (a TV's at the safe area's corner); more lines go below. */}
          <View style={{ gap: u(4), flexShrink: 1, marginTop: caps.touch ? (CLOSE - u(34) * 1.25) / 2 : 0 }}>
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
        </View>

        <If when={episodesOpen() ? what() : null}>
          {(w) => (
            <>
              {/* A tap beside the panel closes it, as the tracks panel's does. */}
              <View role="button" accessibilityLabel={t("player.close_episodes")} onPress={() => episodesOpen.set(false)} style={panelBackdrop} />
              <PlayerEpisodes
                bottom={() => controlsHeight() + safe().y + u(24)}
                show={() => w().title}
                season={() => episodeOf()?.season ?? w().season ?? 1}
                episode={() => episodeOf()?.episode ?? w().episode ?? 1}
                onPlay={(e) => {
                  episodesOpen.set(false);
                  play({ id: e.id, season: e.season, episode: e.number, title: w().title });
                }}
                onClose={() => episodesOpen.set(false)}
              />
            </>
          )}
        </If>
        <If when={panel()}>
          {/* A tap beside the panel closes it, as a sheet's does. */}
          <View role="button" accessibilityLabel={t("player.close_tracks")} onPress={() => panel.set(false)} style={panelBackdrop} />
          <TracksPanel
            bottom={() => controlsHeight() + safe().y + u(24)}
            releases={shortReleases}
            audio={() => menu().audio}
            subtitles={() => menu().subtitles}
            picked={picked}
            focused={(col, i) => panelCol() === col && panelRow() === i}
            onPick={(col, i) => { poke(); panelCol.set(col); panelRow.set(i); pick(col, i); }}
            onClose={() => panel.set(false)}
          />
        </If>

        {/* Bottom: engine line, scrubber, times, buttons. */}
        <If when={ready()}>
          <View onLayout={(e) => controlsHeight.set(e.bounds.size.height)} style={{ position: "absolute", left: safe().x, right: safe().x, bottom: safe().y }}>
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
              onSeek={(s) => { poke(); seekNow(s); }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: u(16) }}>
              <Text style={{ fontFamily: font, fontSize: ts(24), fontWeight: 500, color: colors.snow() }}>
                {Fmt.position(shownSecond())}
              </Text>
              <Text style={{ fontFamily: font, fontSize: ts(24), fontWeight: 500, color: colors.ash() }}>
                {duration() > 0 ? t("player.left", { time: Fmt.position(Math.max(Math.ceil(duration()) - shownSecond(), 0)) }) : ""}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: u(14), marginTop: u(26) }}>
              {/* On the right: the volume (computers). */}
              <If when={volumeShown}>
                <View style={{ position: "absolute", right: 0 }}>
                  <PlayerVolume onUse={poke} />
                </View>
              </If>
              <Each of={buttons} key="index">
                {(id, i) => (
                  <View style={{ marginLeft: id() === "tracks" ? u(22) : 0 }}>
                    <RoundButton
                      icon={() => icon(id())}
                      label={() => label(id())}
                      focused={() => row() === "buttons" && button() === i() && !panel()}
                      selected={() => (id() === "tracks" && panel()) || (id() === "episodes" && episodesOpen())}
                      onPress={() => { poke(); button.set(i()); run(id()); }}
                    />
                  </View>
                )}
              </Each>
            </View>
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
    </View>
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
 * film; a press seeks to where it landed. */
function Scrubber(props: {
  focused: () => boolean;
  position: () => number;
  duration: () => number;
  /** Ready stretches from the core, [from, to] in 0..1. */
  ranges: () => [number, number][];
  onSeek: (seconds: number) => void;
}) {
  const width = signal(0);
  const at = () => (props.duration() > 0 ? Math.min(props.position() / props.duration(), 1) : 0);
  const ranges = computed(() => props.ranges().map(([from, to]) => ({ from, to })));
  const bar = u(8);
  return (
    <View
      testID="scrubber"
      role="adjustable"
      accessibilityLabel={t("player.position")}
      accessibilityValue={{ min: 0, max: Math.round(props.duration()), now: Math.round(props.position()) }}
      onLayout={(e) => width.set(e.bounds.size.width)}
      onPress={(e) => {
        if (width() > 0 && props.duration() > 0) props.onSeek((e.position.x / width()) * props.duration());
      }}
      style={{ marginTop: u(10), paddingVertical: u(14), justifyContent: "center" }}
    >
      <View style={{ height: bar, borderRadius: bar / 2, borderCurve: "continuous", backgroundColor: alpha(colors.snow(), 0.16) }}>
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
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: at() * width(), borderRadius: bar / 2, borderCurve: "continuous", backgroundColor: colors.snow() }} />
      </View>
      <View
        style={{
          position: "absolute",
          left: at() * width() - u(13),
          width: u(26), height: u(26), borderRadius: 999, borderCurve: "continuous",
          backgroundColor: colors.snow(),
          ...focusRing(props.focused()),
        }}
      />
    </View>
  );
}

/** A round player button: its icon only (the label is for screen readers). */
function RoundButton(props: {
  icon: () => ImageAsset;
  label: () => string;
  focused: () => boolean;
  selected: () => boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <View
        role="button"
        accessibilityLabel={props.label()}
        onPress={props.onPress}
        hoverStyle={{ backgroundColor: colors.control() }}
        style={{
          width: u(68), height: u(68), borderRadius: 999, borderCurve: "continuous",
          alignItems: "center", justifyContent: "center",
          backgroundColor: props.selected() ? colors.control() : alpha(colors.raise(), 0.85),
          ...focusRing(props.focused()),
        }}
      >
        <Image src={props.icon()} style={{ width: u(34), height: u(34), tintColor: colors.snow() }} />
      </View>
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
  releases: () => Release[];
  audio: () => TrackOption[];
  subtitles: () => TrackOption[];
  picked: () => Record<number, number>;
  focused: (col: number, i: number) => boolean;
  onPick: (col: number, i: number) => void;
  onClose: () => void;
  /** Where it ends from the player's bottom: above the controls. */
  bottom: () => number;
}) {
  /** The focus fill shows only while the keys drive (as the ring does everywhere); a tap only picks. */
  const lit = (col: number, i: number) => props.focused(col, i) && showFocus();
  const isSelected = (col: number, i: number, fromCore: boolean) => {
    const p = col === 2 ? props.picked()[col] : undefined;
    return p != null ? p === i : fromCore;
  };
  /** `id` names a row for tests (`testID`): `audio-<key>`, `subtitles-<key>` (the core's keys), `release-<index>`. */
  const column = (col: number, heading: string, options: () => { id: string; main: string; sub?: string; selected: boolean }[]) => (
    <View style={{ flex: col === 2 ? 1.25 : 1, paddingHorizontal: u(18), borderLeftWidth: col > 0 ? 1 : 0, borderColor: colors.raise() }}>
      <Text style={{ fontFamily: font, fontSize: ts(21), fontWeight: 500, color: colors.ash(), marginLeft: u(16), marginBottom: u(10) }}>
        {heading}
      </Text>
      {/* A long list scrolls inside the panel. */}
      <Scroll style={{ flex: 1 }} scrollbar={false}>
      <Each of={options()} key="index">
        {(o, i) => (
          <View
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
          </View>
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
      {column(0, t("player.audio"), () => props.audio().map((a, i) => ({ id: `audio-${a.key}`, main: trackName(a, i + 1), sub: trackNote(a), selected: a.selected })))}
      {column(1, t("player.subtitles"), () => props.subtitles().map((s, i) => ({ id: `subtitles-${s.key}`, main: trackName(s, i), sub: trackNote(s), selected: s.selected })))}
      {column(2, t("player.release"), () =>
        props.releases().map((r, i) => ({
          id: `release-${i}`,
          main: `${r.quality} ${r.source}`,
          sub: `${r.size} · ${t("release.sharing_short", { count: r.peers })}`,
          selected: r.selected,
        })),
      )}
      {/* Touch has no Back key on screen: ✕ closes the panel (a tap beside it does too). */}
      <If when={caps.touch}>
        <View role="button" accessibilityLabel={t("player.close_tracks")} hitSlop={targetSlop(u(56))} onPress={props.onClose}
          style={panelCloseStyle()}>
          <View style={{ transform: "rotate(45deg)" }}>
            <Icon src={() => plusIcon} size={iconPt(15)} />
          </View>
        </View>
      </If>
    </View>
  );
}

/** A track's name in the panel: its language, else its title, else its number. */
function trackName(o: TrackOption, number: number) {
  if (o.kind === "original") return t("tracks.audio.original");
  if (o.kind === "off") return t("tracks.subtitles.off");
  // The core gives ISO 639-1 codes for the languages it knows (`languages.*`).
  if (o.language && o.language.length === 2) return t(`languages.${o.language}`);
  if (o.language) return o.language.toUpperCase();
  return o.title || t("tracks.number", { number });
}

/** The line under a track's name: its title, forced, where it comes from or its format. */
function trackNote(o: TrackOption) {
  if (o.kind === "original" || o.kind === "off") return undefined;
  const parts = [
    o.language ? o.title : null,
    o.forced ? t("tracks.forced") : null,
    // The core words the technical part ("AC3 5.1", "SRT").
    o.kind === "external" ? t("tracks.from_torrent") : o.detail,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : undefined;
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
        position: "absolute", right: safe().x, bottom: u(96), width: u(720), maxWidth: "90%",
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
        <View
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
        </View>
        <View
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
        </View>
      </View>
    </View>
  );
}
