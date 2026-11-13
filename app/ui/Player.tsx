// The player: the platform's video view on the local stream under our own
// controls (design/concept/tv-player.html). The overlay shows on any key,
// press or mouse move and hides after a few quiet seconds, unless the film
// is paused or buffering. Remote: Space/Enter play or pause, Left/Right seek
// 10 s on the scrubber row (move between buttons on the buttons row),
// Up/Down switch rows, Escape hides the overlay, then leaves.
import { cleanup, computed, effect, Image, keymap, signal, Text, token, Video, View, type ImageAsset, type VideoRef } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import { filmText } from "../data";
import { fileMap, lowSpace, playback, stop, transfer } from "./playback";
import { formatSize } from "./preferences";
import { readyAhead, readyRanges } from "./scrub";
import { cinema, focusRing, fonts, safe, u } from "./theme";
import backIcon from "./icons/back.svg";
import playIcon from "./icons/play.svg";
import pauseIcon from "./icons/pause.svg";
import rewindIcon from "./icons/rewind.svg";
import forwardIcon from "./icons/forward.svg";

/** How long the overlay stays without input. */
export const OVERLAY_MS = 3000;
const SEEK_S = 10;

type Row = "scrubber" | "buttons";
const BUTTONS = ["play", "back", "forward"] as const;
type ButtonId = (typeof BUTTONS)[number];

export function Player() {
  const p = playback;
  const ready = () => p().phase === "ready";
  const url = () => { const s = p(); return s.phase === "ready" ? s.url : ""; };
  const film = () => { const s = p(); return s.phase === "idle" ? null : s.film; };

  let video: VideoRef | undefined;
  const paused = signal(false);
  const loaded = signal(false);
  /** What `onBuffer` last said. */
  const buffering = signal(false);
  const error = signal<string | null>(null);
  const position = signal(0);
  const duration = signal(0);

  const overlay = signal(true);
  const row = signal<Row>("scrubber");
  const button = signal(0);

  // The overlay hides on its own only while the film plays (not paused,
  // not buffering as `onBuffer` says).
  const mayHide = () => ready() && !paused() && !buffering() && !error();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (mayHide()) hide(); }, OVERLAY_MS);
  };
  /** Hidden, the remote is back on the scrubber: Left/Right seek. */
  const hide = () => {
    clearTimeout(hideTimer);
    overlay.set(false);
    row.set("scrubber");
    button.set(0);
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
  const run = (id: ButtonId) => {
    if (id === "play") togglePause();
    else seekBy(id === "back" ? -SEEK_S : SEEK_S);
  };

  /** A key: wakes the overlay; `act` runs when the film is there to act on. */
  const key = (act: (wasShown: boolean) => void) => () => {
    const wasShown = overlay();
    poke();
    if (ready()) act(wasShown);
  };
  keymap.bind(
    {
      left: key(() => (row() === "buttons" ? button.set(Math.max(button() - 1, 0)) : seekBy(-SEEK_S))),
      right: key(() => (row() === "buttons" ? button.set(Math.min(button() + 1, BUTTONS.length - 1)) : seekBy(SEEK_S))),
    },
    { repeat: true },
  );
  keymap.bind({
    up: key((shown) => shown && row.set("scrubber")),
    down: key((shown) => shown && row.set("buttons")),
    space: key(togglePause),
    enter: key((shown) => (shown && row() === "buttons" ? run(BUTTONS[button()]) : togglePause())),
    escape: () => {
      if (ready() && overlay()) hide();
      else stop();
    },
  });

  const status = () => {
    const s = p();
    if (s.phase === "noSource") return t("player.no_source");
    if (s.phase === "noSpace")
      return s.free == null
        ? t("player.no_space_unknown", { needed: formatSize(s.needed) })
        : t("player.no_space", { needed: formatSize(s.needed), free: formatSize(s.free) });
    if (lowSpace()) return t("player.low_space");
    if (s.phase === "failed") return t("player.failed", { message: s.message });
    if (s.phase === "resolving") return t("player.resolving");
    if (error()) return t("player.failed", { message: error()! });
    if (buffering() || !loaded()) return t("player.buffering");
    return "";
  };
  const failed = () =>
    p().phase === "failed" || p().phase === "noSource" || p().phase === "noSpace" || lowSpace() || error() != null;
  // The device ran out of space while playing: stop where we are, keep the overlay up.
  effect(() => { if (lowSpace()) { paused.set(true); poke(); } });
  const streaming = () => {
    const tr = transfer();
    if (!tr) return "";
    const speed = t("player.speed", { speed: tr.speed.toFixed(1) });
    return tr.peers != null ? `${speed} ${t("player.peers", { count: tr.peers })}` : speed;
  };
  const ahead = computed(() => readyAhead(fileMap(), position(), duration()));
  const aheadText = () => {
    if (!fileMap().length || duration() <= 0) return "";
    const m = Math.floor(ahead() / 60);
    return m >= 1 ? t("player.ready_ahead", { minutes: m }) : t("player.ready_ahead_short");
  };

  return (
    <View
      testID="player"
      style={{ flex: 1, backgroundColor: "#000" }}
      onMouseMove={poke}
      onPress={poke}
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
          <View style={{ width: u(96), height: u(96), borderRadius: 999, borderWidth: u(8), borderColor: cinema.track, borderTopColor: cinema.paper, animationName: "spin", animationDuration: 900, animationTimingFunction: "linear", animationIterationCount: "infinite", animationFrameRate: 30 }} />
        </View>
      </If>

      <If when={overlay()}>
        {/* Top: back, title, what the engine is doing. */}
        <View
          style={{
            position: "absolute", top: 0, left: 0, right: 0,
            paddingHorizontal: safe().x, paddingTop: safe().y, paddingBottom: u(40),
            backgroundColor: cinema.shade,
            flexDirection: "row", alignItems: "center", gap: u(26),
          }}
        >
          <View
            role="button"
            accessibilityLabel={t("player.back")}
            onPress={stop}
            hoverStyle={{ backgroundColor: cinema.button }}
            style={{ width: u(64), height: u(64), borderRadius: 999, alignItems: "center", justifyContent: "center" }}
          >
            <Image src={backIcon} style={{ width: u(40), height: u(40) }} />
          </View>
          <View style={{ gap: u(4), flexShrink: 1 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: u(40), fontWeight: "700", color: cinema.paper }}>
              {film() ? filmText(film()!, "title") : ""}
            </Text>
            <If when={status() !== ""}>
              <Text style={{ fontFamily: fonts.body, fontSize: u(24), color: failed() ? token("destructive") : cinema.mist }}>
                {status()}
              </Text>
            </If>
          </View>
        </View>

        {/* Bottom: engine line, scrubber, times, legend, buttons. */}
        <If when={ready()}>
          <View
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0,
              paddingHorizontal: safe().x, paddingBottom: safe().y, paddingTop: u(40),
              backgroundColor: cinema.shade,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: u(14), minHeight: u(32) }}>
              <If when={aheadText() !== ""}>
                <View style={{ width: u(12), height: u(12), borderRadius: 999, backgroundColor: cinema.ok }} />
                <Text style={{ fontFamily: fonts.body, fontSize: u(24), fontWeight: "600", color: cinema.paper }}>{aheadText()}</Text>
              </If>
              <Text style={{ fontFamily: fonts.body, fontSize: u(24), color: cinema.mist }}>{streaming()}</Text>
            </View>
            <Scrubber
              focused={() => row() === "scrubber"}
              position={position}
              duration={duration}
              buckets={fileMap}
              onSeek={(s) => { poke(); seekTo(s); }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: u(18) }}>
              <Text style={{ fontFamily: fonts.body, fontSize: u(26), fontWeight: "600", color: cinema.paper }}>
                {Fmt.position(Math.floor(position()))}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: u(26), fontWeight: "600", color: cinema.mist }}>
                {duration() > 0 ? t("player.left", { time: Fmt.position(Math.ceil(Math.max(duration() - position(), 0))) }) : ""}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: u(28), marginTop: u(6) }}>
              <Legend color={cinema.paper} label={t("player.watched")} />
              <Legend color={cinema.ready} label={t("player.ready")} />
              <Legend color={cinema.track} label={t("player.not_loaded")} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: u(20), marginTop: u(26) }}>
              <RoundButton
                icon={() => (paused() ? playIcon : pauseIcon)}
                label={() => (paused() ? t("player.play") : t("player.pause"))}
                focused={() => row() === "buttons" && button() === 0}
                onPress={() => { poke(); run("play"); }}
              />
              <RoundButton
                icon={() => rewindIcon}
                label={() => t("player.back_10")}
                focused={() => row() === "buttons" && button() === 1}
                onPress={() => { poke(); run("back"); }}
              />
              <RoundButton
                icon={() => forwardIcon}
                label={() => t("player.forward_10")}
                focused={() => row() === "buttons" && button() === 2}
                onPress={() => { poke(); run("forward"); }}
              />
            </View>
          </View>
        </If>
      </If>
    </View>
  );
}

/** Watched (paper), ready (lamp) and not loaded yet (track) along the film;
 * a press seeks to where it landed. */
function Scrubber(props: {
  focused: () => boolean;
  position: () => number;
  duration: () => number;
  buckets: () => number[];
  onSeek: (seconds: number) => void;
}) {
  const width = signal(0);
  const at = () => (props.duration() > 0 ? Math.min(props.position() / props.duration(), 1) : 0);
  const ranges = computed(() => readyRanges(props.buckets()));
  const bar = u(10);
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
      style={{ marginTop: u(22), paddingVertical: u(14), justifyContent: "center" }}
    >
      <View style={{ height: bar, borderRadius: bar / 2, backgroundColor: cinema.track }}>
        <Each of={ranges()} key={(r) => r.from}>
          {(r) => (
            <View
              style={{
                position: "absolute", top: 0, bottom: 0, borderRadius: bar / 2,
                left: r().from * width(), width: (r().to - r().from) * width(),
                backgroundColor: cinema.ready,
              }}
            />
          )}
        </Each>
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: at() * width(), borderRadius: bar / 2, backgroundColor: cinema.paper }} />
      </View>
      <View
        style={{
          position: "absolute",
          left: at() * width() - u(15),
          width: u(30), height: u(30), borderRadius: 999,
          backgroundColor: cinema.paper,
          ...focusRing(props.focused()),
        }}
      />
    </View>
  );
}

function Legend(props: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: u(10) }}>
      <View style={{ width: u(26), height: u(8), borderRadius: 999, backgroundColor: props.color }} />
      <Text style={{ fontFamily: fonts.body, fontSize: u(21), color: cinema.mist }}>{props.label}</Text>
    </View>
  );
}

function RoundButton(props: { icon: () => string | ImageAsset; label: () => string; focused: () => boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: "rgba(255,255,255,0.18)" }}
      style={{
        width: u(72), height: u(72), borderRadius: 999,
        alignItems: "center", justifyContent: "center",
        backgroundColor: cinema.button,
        ...focusRing(props.focused()),
      }}
    >
      <Image src={props.icon()} style={{ width: u(30), height: u(30) }} />
    </View>
  );
}
