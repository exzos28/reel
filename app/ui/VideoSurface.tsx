// The picture of the player: reel's mpv view (`reel/mpv`, native, macOS
// with libmpv) where the core says it can play, a Samsung TV's AVPlay under
// the web UI (AvplaySurface) on the TV, else NSH's `<Video>` (the
// platform's player). All take the same props and give the same events;
// mpv and AVPlay report and switch tracks (`videoCaps().tracks`).
import { cleanup, nativeComponent, signal, Video, View, type NativeComponentRef, type VideoRef, type ViewStyle } from "nsh";
import { VideoEngine } from "./native";
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

export interface VideoSurfaceProps {
  src: string;
  paused: boolean;
  volume?: number;
  /** mpv's audio track id; null leaves it to the player. */
  audioTrack?: number | null;
  /** mpv's subtitle track id, "no" for none; null leaves it to the player. */
  subtitleTrack?: number | "no" | null;
  progressUpdateInterval?: number;
  style?: ViewStyle;
  surfaceRef?: (r: SurfaceRef) => void;
  onLoad?: (e: { duration: number }) => void;
  onProgress?: (e: { currentTime: number; duration: number }) => void;
  onBuffer?: (e: { isBuffering: boolean }) => void;
  onEnd?: () => void;
  onError?: (e: { message: string }) => void;
  /** mpv's tracks, as JSON for the core (`Engine.tracks`). */
  onTracks?: (json: string) => void;
}

interface MpvProps {
  src: string;
  paused: boolean;
  volume: number;
  audioTrack: number | null;
  subtitleTrack: number | string | null;
  progressUpdateInterval: number;
}

interface MpvEvents {
  load: { duration: number };
  progress: { currentTime: number; duration: number };
  buffer: { isBuffering: boolean };
  end: Record<string, never>;
  error: { message: string };
  tracks: unknown;
}

const MpvView = nativeComponent<MpvProps, MpvEvents>("reel/mpv", {
  props: ["src", "paused", "volume", "audioTrack", "subtitleTrack", "progressUpdateInterval"],
  events: ["load", "progress", "buffer", "end", "error", "tracks"],
});

export function VideoSurface(props: VideoSurfaceProps) {
  return (
    <If when={videoKind() === "mpv"} else={<OtherSurface {...props} />}>
      <MpvView
        ref={(r: NativeComponentRef) => props.surfaceRef?.({ seek: (seconds) => r.command("seek", { seconds }) })}
        src={props.src}
        paused={props.paused}
        volume={props.volume ?? 1}
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

/** Headless tests: loads at once and plays its first frame, then stands still. */
function StillSurface(props: VideoSurfaceProps) {
  const timer = setTimeout(() => {
    props.surfaceRef?.({ seek: () => {} });
    props.onLoad?.({ duration: 0 });
    props.onProgress?.({ currentTime: 0, duration: 0 });
  }, 0);
  cleanup(() => clearTimeout(timer));
  return <View style={props.style} />;
}
