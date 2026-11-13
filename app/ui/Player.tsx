// The player: the platform's video view on the local stream under our own
// controls (design/concept/tv-player.html). The overlay shows on any key,
// press or mouse move and hides after a few quiet seconds, unless the film
// is paused, buffering or the tracks panel is open. Remote: Space/Enter
// play or pause, Left/Right seek 10 s on the scrubber row (move between
// buttons on the buttons row), Up/Down switch rows, Escape closes the
// panel, then hides the overlay, then leaves. Near the end of an episode
// the Up next card (tv-player-end.html) takes the remote instead.
import { cleanup, computed, effect, Image, keymap, signal, Text, Video, View, type ImageAsset, type VideoRef } from "nsh";
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "app/native";
import { episodeCode, episodeText, runtime, titleText, type Episode, type Release } from "./catalog";
import { BACK_SIZE, BackButton, Icon } from "./components";
import { duration, playing as what, play, position, status as core, stop, timeline } from "./playback";
import { alpha, colors, focusRing, font, radius, safe, type, u } from "./theme";
import playIcon from "./icons/play.svg";
import pauseIcon from "./icons/pause.svg";
import rewindIcon from "./icons/rewind.svg";
import forwardIcon from "./icons/forward.svg";
import tracksIcon from "./icons/tracks.svg";
import checkIcon from "./icons/check.svg";

/** How long the overlay stays without input. */
export const OVERLAY_MS = 3000;
/** How long the Up next card counts down before the next episode plays. */
export const UP_NEXT_MS = 6000;
const SEEK_S = 10;

type Row = "scrubber" | "buttons";
const BUTTONS = ["back", "play", "forward", "tracks"] as const;
type ButtonId = (typeof BUTTONS)[number];
const PLAY_BUTTON = 1;

interface Tracks {
  audio: { key: string; selected: boolean }[];
  subtitles: { key: string; selected: boolean }[];
  releases: Release[];
}

export function Player() {
  // Computed, so the twice-a-second status from the core wakes only what changed
  // (a fresh status object must not restart the overlay's hide timer).
  const ready = computed(() => core().phase === "ready");
  const url = computed(() => { const s = core(); return s.phase === "ready" ? s.stream_url : ""; });
  const lowSpace = computed(() => { const s = core(); return s.phase === "ready" && s.low_space; });

  let video: VideoRef | undefined;
  const paused = signal(false);
  const loaded = signal(false);
  /** What `onBuffer` last said. */
  const buffering = signal(false);
  const error = signal<string | null>(null);

  const overlay = signal(true);
  const row = signal<Row>("scrubber");
  const button = signal(PLAY_BUTTON);

  // The tracks panel: three columns, the focus inside it while it is open.
  const panel = signal(false);
  const panelCol = signal(0);
  const panelRow = signal(0);
  const tracks = computed<Tracks>(() => JSON.parse(Catalog.tracks(what()?.id ?? "")));
  /** Demo choices: the panel shows them; NSH's Video has no track API yet. */
  const picked = signal<Record<number, number>>({});
  const columns = computed(() => [tracks().audio.length, tracks().subtitles.length, tracks().releases.length]);

  // Up next: the core says when and what (near the end of an episode).
  const next = computed<Episode | null>(() => {
    const w = what();
    return w ? JSON.parse(Catalog.upNext(w.id, position(), duration())) : null;
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
  const mayHide = () => ready() && !paused() && !buffering() && !error() && !panel();
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
    const to = Math.max(0, d > 0 ? Math.min(seconds, d) : seconds);
    position.set(to);
    video?.seek(to);
  };
  const seekBy = (d: number) => seekTo(position() + d);
  const togglePause = () => paused.set(!paused());
  const openPanel = () => {
    panel.set(true);
    panelCol.set(0);
    panelRow.set(0);
  };
  const run = (id: ButtonId) => {
    if (id === "play") togglePause();
    else if (id === "tracks") (panel() ? panel.set(false) : openPanel());
    else seekBy(id === "back" ? -SEEK_S : SEEK_S);
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
    if (ready()) act(wasShown);
  };
  keymap.bind(
    {
      left: key(
        () => {
          if (panel()) movePanel(-1, 0);
          else if (row() === "buttons") button.set(Math.max(button() - 1, 0));
          else seekBy(-SEEK_S);
        },
        () => cardButton.set(0),
      ),
      right: key(
        () => {
          if (panel()) movePanel(1, 0);
          else if (row() === "buttons") button.set(Math.min(button() + 1, BUTTONS.length - 1));
          else seekBy(SEEK_S);
        },
        () => cardButton.set(1),
      ),
    },
    { repeat: true },
  );
  keymap.bind({
    up: key((shown) => (panel() ? movePanel(0, -1) : shown && row.set("scrubber"))),
    down: key((shown) => (panel() ? movePanel(0, 1) : shown && row.set("buttons"))),
    space: key(togglePause),
    enter: key(
      (shown) => {
        if (panel()) picked.set({ ...picked(), [panelCol()]: panelRow() });
        else if (shown && row() === "buttons") run(BUTTONS[button()]);
        else togglePause();
      },
      () => (cardButton() === 0 ? playNext() : dismissed.set(true)),
    ),
    escape: () => {
      if (card()) dismissed.set(true);
      else if (panel()) panel.set(false);
      else if (ready() && overlay()) hide();
      else stop();
    },
  });

  const status = () => {
    const s = core();
    if (s.phase === "no_source") return t("player.no_source");
    if (s.phase === "no_space")
      return s.free == null
        ? t("player.no_space_unknown", { needed: Fmt.size(s.needed) })
        : t("player.no_space", { needed: Fmt.size(s.needed), free: Fmt.size(s.free) });
    if (s.phase === "failed") return t("player.failed", { message: s.message });
    if (s.phase === "resolving") return t("player.resolving");
    if (lowSpace()) return t("player.low_space");
    if (error()) return t("player.failed", { message: error()! });
    if (buffering() || !loaded()) return t("player.buffering");
    return "";
  };
  const failed = () => {
    const phase = core().phase;
    return phase === "failed" || phase === "no_source" || phase === "no_space" || lowSpace() || error() != null;
  };
  // The device ran out of space while playing: stop where we are, keep the overlay up.
  effect(() => { if (lowSpace()) { paused.set(true); poke(); } });
  const streaming = () => {
    const s = core();
    if (s.phase !== "ready") return "";
    const speed = t("player.speed", { speed: s.speed.toFixed(1) });
    return s.peers != null ? `${speed} ${t("player.peers", { count: s.peers })}` : speed;
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
    : t("player.tracks");
  const icon = (id: ButtonId): ImageAsset =>
    id === "play" ? (paused() ? playIcon : pauseIcon) : id === "back" ? rewindIcon : id === "forward" ? forwardIcon : tracksIcon;

  return (
    <View
      testID="player"
      style={{ flex: 1, backgroundColor: colors.ink() }}
      onMouseMove={() => { if (!card()) poke(); }}
      onPress={() => { if (!card()) poke(); }}
      focusable={false}
    >
      <If when={ready()}>
        <Video
          ref={(r) => (video = r)}
          src={url()}
          controls={false}
          paused={paused()}
          progressUpdateInterval={250}
          onLoad={(e) => { loaded.set(true); duration.set(e.duration); }}
          onProgress={(e) => { position.set(e.currentTime); if (e.duration > 0) duration.set(e.duration); }}
          onBuffer={(e) => buffering.set(e.isBuffering)}
          onEnd={() => { paused.set(true); poke(); }}
          onError={(e) => error.set(e.message)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </If>

      <If when={ready() && !failed() && (buffering() || !loaded())}>
        <View
          testID="buffering"
          style={{ pointerEvents: "none", position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: u(96), height: u(96), borderRadius: 999, borderCurve: "continuous", borderWidth: u(8), borderColor: alpha(colors.snow(), 0.16), borderTopColor: colors.snow(), animationName: "spin", animationDuration: 900, animationTimingFunction: "linear", animationIterationCount: "infinite", animationFrameRate: 30 }} />
        </View>
      </If>

      <If when={overlay() && !card()}>
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
        <View style={{ position: "absolute", top: safe().y, left: safe().x, right: safe().x, flexDirection: "row", alignItems: "flex-start", gap: u(24) }}>
          <BackButton
            focused={() => false}
            onPress={stop}
            label={() => t("player.back")}
            background={() => alpha(colors.card(), 0.8)}
          />
          {/* The title's first line centred on the button; more lines go below. */}
          <View style={{ gap: u(4), flexShrink: 1, marginTop: (u(BACK_SIZE) - u(34) * 1.25) / 2 }}>
            <Text style={{ fontFamily: font, fontSize: u(34), fontWeight: 600, color: colors.snow() }}>
              {what() ? titleText(what()!.title) : ""}
            </Text>
            <If when={subtitle() !== ""}>
              <Text style={{ ...type.meta(), color: colors.ash() }}>{subtitle()}</Text>
            </If>
            <If when={status() !== ""}>
              <Text style={{ ...type.meta(), color: failed() ? colors.red() : colors.ash() }}>{status()}</Text>
            </If>
          </View>
        </View>

        <If when={panel()}>
          <TracksPanel
            tracks={tracks}
            picked={picked}
            focused={(col, i) => panelCol() === col && panelRow() === i}
            onPick={(col, i) => { poke(); panelCol.set(col); panelRow.set(i); picked.set({ ...picked(), [col]: i }); }}
          />
        </If>

        {/* Bottom: engine line, scrubber, times, buttons. */}
        <If when={ready()}>
          <View style={{ position: "absolute", left: safe().x, right: safe().x, bottom: safe().y }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", minHeight: u(32) }}>
              <If when={aheadText() !== ""}>
                <Text style={{ fontFamily: font, fontSize: u(24), fontWeight: 600, color: colors.snow() }}>{aheadText()}</Text>
                <Text style={{ fontFamily: font, fontSize: u(24), color: colors.ash() }}>{" · "}</Text>
              </If>
              <Text style={{ fontFamily: font, fontSize: u(24), color: colors.soft() }}>{streaming()}</Text>
            </View>
            <Scrubber
              focused={() => row() === "scrubber" && !panel()}
              position={position}
              duration={duration}
              ranges={() => timeline().ranges}
              onSeek={(s) => { poke(); seekTo(s); }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: u(16) }}>
              <Text style={{ fontFamily: font, fontSize: u(24), fontWeight: 500, color: colors.snow() }}>
                {Fmt.position(Math.floor(position()))}
              </Text>
              <Text style={{ fontFamily: font, fontSize: u(24), fontWeight: 500, color: colors.ash() }}>
                {duration() > 0 ? t("player.left", { time: Fmt.position(Math.ceil(Math.max(duration() - position(), 0))) }) : ""}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: u(14), marginTop: u(26) }}>
              <Each of={[...BUTTONS]} key="index">
                {(id, i) => (
                  <View style={{ marginLeft: id() === "tracks" ? u(22) : 0 }}>
                    <RoundButton
                      icon={() => icon(id())}
                      label={() => label(id())}
                      focused={() => row() === "buttons" && button() === i() && !panel()}
                      selected={() => id() === "tracks" && panel()}
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

/** A round player button: no visible label; the focused one shows it above. */
function RoundButton(props: {
  icon: () => ImageAsset;
  label: () => string;
  focused: () => boolean;
  selected: () => boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <If when={props.focused()}>
        <View
          style={{
            position: "absolute", bottom: u(86), paddingHorizontal: u(14), paddingVertical: u(8),
            borderRadius: u(8), borderCurve: "continuous", backgroundColor: colors.card(), minWidth: u(68), alignItems: "center",
          }}
        >
          <Text style={{ numberOfLines: 1, ...type.small(), color: colors.snow() }}>{props.label()}</Text>
        </View>
      </If>
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
function TracksPanel(props: {
  tracks: () => Tracks;
  picked: () => Record<number, number>;
  focused: (col: number, i: number) => boolean;
  onPick: (col: number, i: number) => void;
}) {
  const isSelected = (col: number, i: number, fromCore: boolean) => {
    const p = props.picked()[col];
    return p != null ? p === i : fromCore;
  };
  const column = (col: number, heading: string, options: () => { main: string; sub?: string; selected: boolean }[]) => (
    <View style={{ flex: col === 2 ? 1.25 : 1, paddingHorizontal: u(18), borderLeftWidth: col > 0 ? 1 : 0, borderColor: colors.raise() }}>
      <Text style={{ fontFamily: font, fontSize: u(21), fontWeight: 500, color: colors.ash(), marginLeft: u(16), marginBottom: u(10) }}>
        {heading}
      </Text>
      <Each of={options()} key="index">
        {(o, i) => (
          <View
            role="button"
            accessibilityLabel={o().main}
            accessibilityState={{ selected: isSelected(col, i(), o().selected) }}
            onPress={() => props.onPick(col, i())}
            hoverStyle={{ backgroundColor: colors.card() }}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              minHeight: u(o().sub ? 74 : 60), paddingHorizontal: u(16), borderRadius: radius(), borderCurve: "continuous",
              backgroundColor: props.focused(col, i()) || isSelected(col, i(), o().selected) ? colors.card() : "transparent",
              ...focusRing(props.focused(col, i())),
            }}
          >
            <View style={{ flexShrink: 1 }}>
              <Text style={{ ...type.label(), color: isSelected(col, i(), o().selected) || props.focused(col, i()) ? colors.snow() : colors.soft() }}>
                {o().main}
              </Text>
              <If when={o().sub}>
                <Text style={{ fontFamily: font, fontSize: u(19), color: colors.ash(), marginTop: u(2) }}>{o().sub}</Text>
              </If>
            </View>
            <If when={isSelected(col, i(), o().selected)}>
              <Icon src={() => checkIcon} size={24} />
            </If>
          </View>
        )}
      </Each>
    </View>
  );
  return (
    <View
      style={{
        position: "absolute", top: u(150), right: safe().x, width: u(1020), maxWidth: "90%",
        flexDirection: "row", padding: u(26), borderRadius: radius() + u(26), borderCurve: "continuous", backgroundColor: alpha(colors.card(), 0.94),
      }}
    >
      {column(0, t("player.audio"), () => props.tracks().audio.map((a) => ({ main: t(`tracks.audio.${a.key}`), selected: a.selected })))}
      {column(1, t("player.subtitles"), () => props.tracks().subtitles.map((s) => ({ main: t(`tracks.subtitles.${s.key}`), selected: s.selected })))}
      {column(2, t("player.release"), () =>
        props.tracks().releases.map((r) => ({
          main: `${r.quality} ${r.source}`,
          sub: `${r.size} · ${t("release.sharing_short", { count: r.peers })}`,
          selected: r.selected,
        })),
      )}
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
          <Text style={{ fontFamily: font, fontSize: u(21), color: colors.ash() }}>
            {t("player.next_episode", { code: episodeCode(e().season, e().number) })}
          </Text>
          <Text style={{ numberOfLines: 2, fontFamily: font, fontSize: u(28), fontWeight: 600, color: colors.snow() }}>
            {episodeText(e().show, e().season, e().number, "title")}
          </Text>
          <Text style={{ fontFamily: font, fontSize: u(21), color: colors.ash() }}>{runtime(e().minutes)}</Text>
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
