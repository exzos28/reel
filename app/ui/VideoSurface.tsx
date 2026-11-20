// The picture of the player: reel's mpv view (`reel/mpv`, native, macOS
// with libmpv) where the core says it can play, a Samsung TV's AVPlay under
// the web UI (AvplaySurface) on the TV, else NSH's `<Video>` (the
// platform's player). All take the same props and give the same events;
// mpv and AVPlay report and switch tracks (`videoCaps().tracks`).
//
// A seek goes to the view only once the core has the place on disk (`Engine.seek`): no
// player ever waits in pieces still to come (a TV's AVPlay holds the whole page while it
// does). The player's screen just asks for the seek and hears when it is there.
import { cleanup, nativeComponent, signal, Video, View, type NativeComponentRef, type VideoRef, type ViewStyle } from "nsh";
import { Engine, VideoEngine } from "./native";
import { currentJob } from "./playback";
import { AvplaySurface } from "./AvplaySurface";

/** Which view plays here, as the core decides (`VideoEngine.kind`). */
/** `still` is the headless tests' stand-in, a view that reports itself loaded
 * at once (a headless `<Video>` never loads). */
export const videoKind = signal<"mpv" | "avplay" | "native" | "still">("native");
// Asked once at start; choosing mpv also widens the releases searches offer.
Promise.resolve(VideoEngine.kind())
  .then((k) => videoKind.set(k === "mpv" || k === "avplay" || k === "still" ? k : "native"))
  .catch((e) => console.warn("video engine", e));

/** What the view that plays here can do. */
export const videoCaps = () => ({ tracks: videoKind() === "mpv" || videoKind() === "avplay" });

/** The picture is drawn under the UI (AVPlay on the TV's video plane): the
 * player's screen and the app around it must leave their backgrounds clear. */
export const videoUnderUi = () => videoKind() === "avplay";

export interface SurfaceRef {
  seek(seconds: number): void;
}

/** How near the target a view's time must be for a seek to be there, seconds (a TV's AVPlay
 * lands on the keyframe before it). */
const SEEK_NEAR_S = 3;
/** How long a seek sent to the view may go without a time near its target before it counts as
 * there (paused, a view may report no time after a seek), ms. */
const SEEK_WAIT_MS = 12000;

export interface VideoSurfaceProps {
  src: string;
  paused: boolean;
  volume?: number;
  /** The languages to start in before the tracks are known (the core's `apply.audioLanguages`,
   * mpv's `alang`: "ru,rus"). */
  audioLanguages?: string;
  /** mpv's audio track id; null leaves it to the player. */
  audioTrack?: number | null;
  /** mpv's subtitle track id, "no" for none; null leaves it to the player. */
  subtitleTrack?: number | "no" | null;
  progressUpdateInterval?: number;
  /** The share of the view's height the player's controls cover now: subtitles the player draws
   * itself (mpv's, embedded in the film) rise above them. */
  subtitleLift?: number;
  style?: ViewStyle;
  surfaceRef?: (r: SurfaceRef) => void;
  /** Loaded: how long the film is, and its picture's size as shown (pixels) where the view says. */
  onLoad?: (e: { duration: number; width?: number; height?: number }) => void;
  onProgress?: (e: { currentTime: number; duration: number; cached?: number; readAt?: number; readTime?: number }) => void;
  onBuffer?: (e: { isBuffering: boolean }) => void;
  onEnd?: () => void;
  /** A seek is on its way to `seconds`: its place is being fetched, then the view goes there.
   * Until `onSeeked`, the view's times are still the old place's. */
  onSeeking?: (seconds: number) => void;
  /** The seek is over: the view is at the place (or the seek could not be made); its times
   * stand. */
  onSeeked?: () => void;
  /** `code`: what went wrong, for the UI to word (`view`: the video view could not start); `message`: the player's own words. */
  onError?: (e: { message: string; code?: string }) => void;
  /** mpv's tracks, as JSON for the core (`Engine.tracks`). */
  onTracks?: (json: string) => void;
}

interface MpvProps {
  src: string;
  paused: boolean;
  volume: number;
  audioLanguages: string;
  audioTrack: number | null;
  subtitleTrack: number | string | null;
  progressUpdateInterval: number;
  subtitleLift: number;
}

interface MpvEvents {
  load: { duration: number; width?: number; height?: number };
  /** `cached`: seconds of the film the view holds ahead of `currentTime` (mpv's cache). */
  progress: { currentTime: number; duration: number; cached?: number; readAt?: number; readTime?: number };
  buffer: { isBuffering: boolean };
  end: Record<string, never>;
  error: { message: string };
  tracks: unknown;
}

const MpvView = nativeComponent<MpvProps, MpvEvents>("reel/mpv", {
  // The languages before `src`: mpv starts in them.
  props: ["audioLanguages", "src", "paused", "volume", "audioTrack", "subtitleTrack", "progressUpdateInterval", "subtitleLift"],
  events: ["load", "progress", "buffer", "end", "error", "tracks"],
});

export function VideoSurface(props: VideoSurfaceProps) {
  let view: SurfaceRef | undefined;
  /** Counts the seeks: an answer for an older one is dropped. */
  let gen = 0;
  /** A seek sent to the view and not there yet. */
  let sent: number | null = null;
  let sentTimer: ReturnType<typeof setTimeout> | undefined;
  /** A seek waiting for its place holds the view still: the old place does not play on under
   * the loader while the new one comes. Not the viewer's pause, and only until the seek goes to
   * the view (a paused view may not report its time, by which the seek is seen to arrive). */
  const holding = signal(false);
  cleanup(() => { gen++; clearTimeout(sentTimer); });
  const over = () => {
    sent = null;
    clearTimeout(sentTimer);
    holding.set(false);
    props.onSeeked?.();
  };
  const arrived = () => { if (sent != null) over(); };
  const send = (to: number) => {
    sent = to;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(arrived, SEEK_WAIT_MS);
    // The seek first, then the view plays on: it does not play a moment of the old place.
    view?.seek(to);
    holding.set(false);
  };
  props.surfaceRef?.({
    seek: (to) => {
      const g = ++gen;
      sent = null;
      clearTimeout(sentTimer);
      holding.set(true);
      props.onSeeking?.(to);
      const job = currentJob();
      if (!job) return send(to);
      Engine.seek(job, to).then(
        (r) => {
          if (g !== gen) return;
          const { state } = JSON.parse(r) as { state: "ready" | "replaced" | "unknown" };
          // Replaced while this seek is the last one: the job closed (the next episode, a
          // retry), so the seek is over.
          if (state === "replaced") over();
          else send(to);
        },
        (e) => {
          console.warn("seek: the core could not get the place ready", e);
          if (g === gen) over();
        },
      );
    },
  });
  return (
    <PlayerView
      {...props}
      paused={props.paused || holding()}
      surfaceRef={(r) => (view = r)}
      onLoad={(e) => props.onLoad?.(e)}
      onProgress={(e) => {
        if (sent != null && Math.abs(e.currentTime - sent) <= SEEK_NEAR_S) over();
        props.onProgress?.(e);
      }}
      onSeeked={arrived}
      onError={(e) => {
        gen++;
        sent = null;
        clearTimeout(sentTimer);
        holding.set(false);
        props.onError?.(e);
      }}
    />
  );
}

/** The view that plays here, as `videoKind` says. */
function PlayerView(props: VideoSurfaceProps) {
  return (
    <If when={videoKind() === "mpv"} else={<OtherSurface {...props} />}>
      <MpvView
        ref={(r: NativeComponentRef) => props.surfaceRef?.({ seek: (seconds) => r.command("seek", { seconds }) })}
        src={props.src}
        paused={props.paused}
        volume={props.volume ?? 1}
        subtitleLift={props.subtitleLift ?? 0}
        audioLanguages={props.audioLanguages ?? ""}
        audioTrack={props.audioTrack ?? null}
        subtitleTrack={props.subtitleTrack ?? null}
        progressUpdateInterval={props.progressUpdateInterval ?? 250}
        onLoad={(e) => props.onLoad?.(e)}
        onProgress={(e) => props.onProgress?.(e)}
        onBuffer={(e) => props.onBuffer?.(e)}
        onEnd={() => props.onEnd?.()}
        onError={(e) => props.onError?.(e)}
        onTracks={(e) => props.onTracks?.(JSON.stringify(e))}
        style={props.style}
      />
    </If>
  );
}

function OtherSurface(props: VideoSurfaceProps) {
  return (
    <If when={videoKind() === "avplay"} else={<TestOrNativeSurface {...props} />}>
      <AvplaySurface {...props} />
    </If>
  );
}

function TestOrNativeSurface(props: VideoSurfaceProps) {
  return (
    <If when={videoKind() === "still"} else={<NativeSurface {...props} />}>
      <StillSurface {...props} />
    </If>
  );
}

function NativeSurface(props: VideoSurfaceProps) {
  return (
    <Video
      ref={(r: VideoRef) => props.surfaceRef?.({ seek: (seconds) => r.seek(seconds) })}
      src={props.src}
      controls={false}
      paused={props.paused}
      volume={props.volume ?? 1}
      progressUpdateInterval={props.progressUpdateInterval ?? 250}
      onLoad={(e) => props.onLoad?.(e)}
      onProgress={(e) => props.onProgress?.(e)}
      onBuffer={(e) => props.onBuffer?.(e)}
      onEnd={() => props.onEnd?.()}
      onError={(e) => props.onError?.(e)}
      style={props.style}
    />
  );
}

/** Headless tests: loads at once (a 1920×1080 picture) and plays its first frame, then stands still. */
function StillSurface(props: VideoSurfaceProps) {
  const timer = setTimeout(() => {
    props.surfaceRef?.({ seek: () => {} });
    props.onLoad?.({ duration: 0, width: 1920, height: 1080 });
    props.onProgress?.({ currentTime: 0, duration: 0 });
  }, 0);
  cleanup(() => clearTimeout(timer));
  return <View style={props.style} />;
}
