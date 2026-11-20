// The picture on a Samsung TV: AVPlay, which the TV shell plays on the video
// plane under the web UI (./avplay.ts). Same props and events as the other
// views of VideoSurface; this view itself draws nothing, so the picture shows
// through it. Volume is the TV's own.
import { cleanup, effect, View } from "nsh";
import { avplayLink, clearPageBackgrounds, type AvplayEvent, type AvplayOp } from "./avplay";
import type { VideoSurfaceProps } from "./VideoSurface";

/** The longest a prepared stream waits for the core's audio track before it plays anyway, ms. */
const AUDIO_WAIT_MS = 1500;

export function AvplaySurface(props: VideoSurfaceProps) {
  const link = avplayLink();
  /** The stream AVPlay has open: until it says `loaded`, ops wait. */
  let loaded = false;
  let duration = 0;
  /** What AVPlay applies now, as far as we told it. */
  let pausedNow = false;
  let audioNow: number | null = null;
  let seekTo: number | null = null;
  /** Prepared, AVPlay waits (`hold`) until the core says which audio track plays: the viewer
   * never hears a moment of another one. */
  let waitingAudio = false;
  let audioTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(audioTimer));

  const send = (op: AvplayOp) => {
    try {
      link?.send(op);
    } catch (e) {
      props.onError?.({ message: String(e) });
    }
  };
  const apply = () => {
    if (!loaded) return;
    const audio = props.audioTrack ?? null;
    if (audio != null && audio !== audioNow) {
      audioNow = audio;
      send({ op: "track", trackType: "AUDIO", index: audio });
    }
    if (audio != null && waitingAudio) {
      waitingAudio = false;
      clearTimeout(audioTimer);
    }
    if (!waitingAudio && props.paused !== pausedNow) {
      pausedNow = props.paused;
      send({ op: pausedNow ? "pause" : "play" });
    }
    if (seekTo != null) {
      send({ op: "seek", position: seekTo });
      seekTo = null;
    }
  };

  const onEvent = (e: AvplayEvent) => {
    switch (e.type) {
      case "loaded": {
        loaded = true;
        duration = e.duration;
        // Prepared, AVPlay holds on its first audio track until `play`: the core's track first.
        pausedNow = true;
        audioNow = e.tracks?.find((t) => t.type === "AUDIO")?.index ?? null;
        waitingAudio = true;
        clearTimeout(audioTimer);
        audioTimer = setTimeout(() => {
          waitingAudio = false;
          apply();
        }, AUDIO_WAIT_MS);
        // The core reads AVPlay's tracks (`Engine.tracks`).
        props.onTracks?.(JSON.stringify({ avplay: e.tracks ?? [] }));
        props.onLoad?.({ duration });
        apply();
        break;
      }
      case "time":
        props.onProgress?.({ currentTime: e.position, duration });
        break;
      case "buffering":
        props.onBuffer?.({ isBuffering: e.buffering });
        break;
      case "ended":
        props.onEnd?.();
        break;
      case "seeked":
        props.onSeeked?.();
        break;
      case "error":
        props.onError?.({ message: e.message });
        break;
    }
  };

  if (link) {
    cleanup(link.listen(onEvent));
    cleanup(clearPageBackgrounds());
  } else {
    const timer = setTimeout(() => props.onError?.({ message: "no AVPlay here (the page is not in the TV shell)" }), 0);
    cleanup(() => clearTimeout(timer));
  }

  props.surfaceRef?.({
    seek: (seconds) => {
      seekTo = seconds;
      apply();
    },
  });

  // A new stream: AVPlay closes what played and opens it.
  effect(() => {
    const src = props.src;
    loaded = false;
    seekTo = null;
    if (src) send({ op: "open", url: src, hold: true });
  });
  effect(() => {
    void props.paused;
    void props.audioTrack;
    apply();
  });
  cleanup(() => send({ op: "stop" }));

  return <View style={props.style} />;
}
