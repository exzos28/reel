# How the player draws its picture

What owns the picture's drawable on each platform, how mpv learns its size, and what happens on a
turn, a resize and the app's lifecycle. The rule above all: **once a film plays, nothing restarts
mpv's video output or its decoder because the view changed size.** On an iPhone that cost the
picture (VideoToolbox decoded on without its reference frames, fell back to the CPU, showed
nothing) and a jump back to the keyframe.

## 1. The surface

**iOS / iPadOS** (`app/src/adapters/mpv/ios.rs`). mpv draws into reel's `CAMetalLayer` itself
(`vo=gpu-next`, `gpu-context=moltenvk`, `wid` = the layer). Facts that shape the design, from the
sources of the libmpv we ship (MPVKit 1.1.0: mpv 0.41, libplacebo 7.360, MoltenVK 1.4.2):

- MPVKit's MoltenVK context reads `layer.drawableSize` only in its `reconfig`, which mpv calls at
  the first frame of a file whose frame parameters differ from the last (`video.c`,
  `mp_image_params_static_equal`). Its `control` answers nothing, so nothing tells mpv later that
  the layer changed. The one external-resize trigger, `android-surface-size`, exists only in
  Android builds.
- MoltenVK finds a swapchain optimal only while `drawableSize` = its size = `bounds ×
  contentsScale`. Otherwise it answers `VK_SUBOPTIMAL_KHR`, and libplacebo builds a new swapchain
  at `bounds × contentsScale` while mpv keeps drawing for the old size: a cropped or squeezed
  picture. This is why changing the layer's frame never worked without restarting the output.

So the layer is a fixed **canvas**:

- Canvas `C` (whole pixels) is set once per file, before mpv's output configures:
  `layer.bounds = C / s` (s = the screen's scale), `contentsScale = s`, `drawableSize = C`.
  MoltenVK always sees `C`.
- Where the canvas shows: `layer.position` (the view's centre) and `layer.transform` (a uniform
  scale) fit it into the view's bounds, centred. The view is black and clips.
- `C`'s aspect is the picture's. `C` is the largest box of that aspect that fits the screen
  (`bounds × scale`) in either orientation, so the picture is 1:1 in its best orientation and
  Core Animation scales it down in the other. 16:9 on a 2868×1320 phone gives 2347×1320: 1:1
  sideways, ×0.56 upright. When the aspect is not known, `C` is the view's size in pixels at its
  first layout.
- The aspect comes from mpv's `on_preloaded` hook. mpv waits there after it has read the file's
  tracks and before it starts the video chain and its output (`loadfile.c`). The handler reads
  `track-list` and takes the video track mpv will pick (`vid` if set, else the default track,
  else the first that is not cover art). From it, `reel_domain::play::shown_size(demux-w, demux-h,
  demux-par, demux-rotation)` gives the shown size.
- Threading:
  - The hook event comes on the player's event thread, which reads the track list (mpv answers
    property reads while it waits in a hook). It never waits for the main thread.
  - It posts to the main thread (`dispatch_async`). The main thread works out `C`, applies it
    to the layer, then lets mpv go on (`mpv_hook_continue`). The main thread waits on mpv only
    for the client API's short lock, as it does for every property it sets.
  - A hook is continued exactly once: by that main-thread task, or by the player's teardown
    before mpv is destroyed. mpv's hook id is the handler's, the same for every file, so a
    per-file counter makes sure a late task never continues the next file's hook.

**Android** (`android.rs`, `MpvView.java`). A TextureView's Surface is `wid`, with `vo=gpu`. A
size change sets `android-surface-size`, which resizes mpv's swapchain in place
(`VOCTRL_EXTERNAL_RESIZE`): no restart. `vo=null` happens only when the Surface is destroyed.
No change.

**macOS, Linux, Windows** (`view.rs`, `linux.rs`, `windows.rs`). mpv's render API (OpenGL
FBO, D3D11 texture). The view passes its size with every frame, and a resize only gives a new
target. No change.

**Samsung TV** (`AvplaySurface.tsx`, `shell.js`). AVPlay draws on the TV's video plane at a
fixed 1920×1080 rectangle, letterboxed, under a page that is 1920×1080 as well. Nothing resizes.

## 2. Turns, resizes, split view

- One owner turns the phone: the player, through `VideoEngine.turn` (`ios_awake::turn`, a scene
  geometry request that works with the rotation lock on). It turns:
  - sideways as the player opens on a phone held upright;
  - back upright at load, only for a picture taller than wide;
  - either way with Rotate;
  - upright when the player closes;
  - back to the orientation it had when the app returns from the background.
- The root controller allows landscape on a phone only while a player is up or has asked for it
  (`SIDEWAYS_ASKED`). A device turning in the hand still turns it while rotation is unlocked.
- The sequence: UIKit turns the scene → `layoutSubviews` of `ReelMpvView` → the canvas is fitted
  again (position and transform, with no implicit animation), and the film's subtitle margins
  are mapped again (§4). mpv is not called for the picture. iPad split view, Stage Manager and
  slide over take the same path.
- Turning at open is now for the viewer only (the film opens sideways). mpv no longer needs it.

## 3. Lifecycle

- **First layout:** sets `wid` and `vo=gpu-next`, applies the fallback canvas and opens the
  `LoadGate`. Files wait for a layout because the fallback needs the view's size.
- **Next episode in the same view** (`loadfile replace`): mpv keeps its output and reconfigures
  only when the frame parameters change.
  - A different aspect means different parameters (width, height, pixel aspect and rotation
    are among them), so mpv reconfigures and reads the new `C` set in that file's hook.
  - The same aspect gives the same `C`, since `C` depends only on the aspect and the screen.
  - An unknown aspect keeps the `C` it has.
  - One case is accepted: the container gives a size that differs from the decoded frames while
    the frames' parameters stay equal. That file then shows a few pixels cropped or
    letterboxed.
- **Background / foreground:** stays `vid=no` / `vid=auto`. With no video track and no
  `force-window`, mpv drops its output, so nothing is drawn with the GPU in the background,
  which iOS forbids (MoltenVK would mark the device lost). Back in front, a new output reads `C`.
  A new decoder starts at a keyframe with mpv's own exact refresh seek, as a resume at open
  does, and `own_wait` keeps that wait from showing as buffering. This also creates a new
  decoder mid-film, the thing that failed after a restarted output, so it needs a device check
  (§5).
- **Leaving:**
  1. Silence first: `paused` and volume 0 in the UI, then `stop` in `Player::drop`.
  2. A held hook is continued.
  3. The event thread is joined, and mpv is destroyed.

## 4. What lies over the picture

- **The film's own subtitles** (libass, embedded tracks) are drawn by mpv into `C`, the picture's
  box. The UI keeps one rule on every platform (`filmSubtitles` in `Player.tsx`): how far up and
  how far in, measured from the view's edges, as shares of the picture's height.
- The iOS adapter maps those shares into the canvas. Lift becomes `max(0, lift − barY / (H ·
  scale))` and the sides become `max(0, sides − barX / (H · scale))`, where `bar` is the gap
  between the view's edge and the box, `H` the box's height, and `scale` is `subtitleScale`.
  Sizes stay as they are, a share of the picture's height.
  - Held upright, the subtitles sit at the picture's bottom with mpv's own margin, as
    `subtitleBottom` places reel's, and above the middle buttons when two lines would reach
    them.
  - Sideways, they keep to the picture's width.
- **reel's subtitles** (`SubtitleOverlay`, files from the release) are a view in window
  coordinates. Their picture is the picture's aspect fitted into the window, the same box as
  the canvas, so both kinds line up. With the fallback canvas (aspect unknown at the hook) the
  picture sits letterboxed inside the box, and the two may differ by the bars.
- **Controls, the loading stage, the waiting line:** NSH views above the video view, in window
  coordinates. The canvas does not change them.

## 5. Removed, and what needs the device

Removed, iOS only:

- starting the output again on a new size (`vo=null` → `vo=gpu-next`);
- the keyframe seek after it;
- the size waiting for mpv's first frame and for a seek's place (`pending`,
  `restart_when_settled`, `Player::settled` / `when_shown`);
- the `seekWaiting` prop.

To confirm on an iPhone (the simulator does not show the decoder failure):

1. Open a film upright, Rotate several times, turn the phone by hand, pause and turn. The
   picture stays, sound does not stutter, there is no jump back, and the log has one `layer …,
   canvas` line per file with no `resized`.
2. Back to the home screen mid-film for 10 s and return. The log should say `decoding with
   videotoolbox`, with no `hardware accelerator failed`. If it fails, the next step is to pause
   in the background and keep the video track, holding back redraws while away. Not done now
   because a frame drawn in the background could lose the GPU device for good.
3. A 2.39:1 film and a 4:3 one sideways and upright: the picture is centred and sharp, and
   embedded subtitles sit inside the picture and above the controls.
4. A next episode with another aspect: the new canvas comes from its hook, so there is no
   squeezed frame.
