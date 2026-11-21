# How the player draws its picture

What owns the picture's drawable on each platform, how mpv learns its size, and what happens on a
turn, a resize and the app's lifecycle. The rule above all: **once a film plays, nothing restarts
mpv's video output or its decoder because the view changed size.** On an iPhone that cost the
picture and caused a jump back to the keyframe. The picture was lost because a new output started
at a 1×1 drawable, and VideoToolbox decoded without its reference frames and fell back to the CPU.

## 1. The surface

**iOS / iPadOS** (`app/src/adapters/mpv/ios.rs`). mpv draws into reel's `CAMetalLayer` itself
(`vo=gpu-next`, `gpu-context=moltenvk`, `wid` = the layer). Facts that shape the design, from the
sources of the libmpv we ship (MPVKit 1.1.0: mpv 0.41, libplacebo 7.360, MoltenVK 1.4.2):

- MPVKit's MoltenVK context reads `layer.drawableSize` only in its `reconfig`, which mpv calls at
  the first frame of an output and whenever the frames' kind changes (`video.c`,
  `mp_image_params_static_equal`). Its `control` answers nothing, so nothing tells mpv later that
  the layer changed. The one external-resize trigger, `android-surface-size`, exists only in
  Android builds.
- MoltenVK finds a swapchain optimal only while `drawableSize` = its size = `bounds ×
  contentsScale`. Otherwise it answers `VK_SUBOPTIMAL_KHR`, and libplacebo builds a new swapchain
  at `bounds × contentsScale` while mpv keeps drawing for the old size: a cropped or squeezed
  picture.
- When an output goes while frames are still on their way to the screen, MoltenVK sets
  `drawableSize` to 1×1 (`forceUnpresentedImageCompletion`) and leaves it there. The next output
  starts at 1×1 and draws nothing: likely the device's lost picture after a restart.

So the layer is a fixed **canvas**:

- Canvas `C` (whole pixels) is set on the layer before every new output: `layer.bounds = C / s`
  (s = the screen's `scale`, never `nativeScale`), `contentsScale = s`, `drawableSize = C`. It is
  set even when `C` is unchanged, to undo MoltenVK's 1×1. MoltenVK always sees `C`.
- Where the canvas shows: `layer.position` (the view's centre) and `layer.transform` (a uniform
  scale) fit it into the view, centred. The view is black and clips. Inside UIKit's rotation
  animation (an iPad's) the two change with the turn's duration
  (`UIView.inheritedAnimationDuration`).
- `C`'s aspect is the picture's. `C` is the largest box of that aspect that fits the window
  (`bounds × scale`, the screen on a phone) in either orientation. The picture is 1:1 in its
  best orientation, and Core Animation scales it down (linear, no mipmaps) in the other. 16:9 on
  a 2868×1320 phone gives 2346×1320: 1:1 sideways, ×0.46 upright. A side leaves an even number of
  pixels to the window's, so the centred picture starts on a whole pixel.
- The aspect comes from mpv's `on_preloaded` hook. mpv waits there after it has read the file's
  tracks and before it picks them and starts the decoder and output (`loadfile.c`). The handler
  reads `track-list` and takes the video track mpv will pick (`vid` if set, else the default,
  else not cover art, else the first). From it, `shown_size` of its crop (or size), pixel
  aspect and rotation gives the picture. A wrong guess only letterboxes the picture inside `C`.
  Unknown: `C` stays. Until the first file's hook, `C` is a 16:9 box of the window, as mpv
  assumes 16:9 for a picture it knows nothing of.
- Threading:
  - The hook event comes on the player's event thread, which reads the track list (mpv answers
    property reads while it waits in a hook). It never waits for the main thread.
  - It posts to the main thread (`dispatch_async`). The main thread sets `C`, then lets mpv go on
    (`mpv_hook_continue`), on every path, even for a view already gone. The main thread waits on
    mpv only for the client API's short lock.
  - mpv waits in a hook until it is continued, even to stop. If the player goes first, its
    teardown continues a held hook before mpv is destroyed, and a main-thread task that comes
    later does nothing (`Hooks::closed`), never touching a freed handle.

**Android** (`android.rs`, `MpvView.java`). A TextureView's Surface is `wid`, with `vo=gpu`. A
size change sets `android-surface-size`, which resizes mpv's swapchain in place
(`VOCTRL_EXTERNAL_RESIZE`): no restart. `vo=null` happens only when the Surface is destroyed.
No change.

**macOS, Linux, Windows** (`view.rs`, `linux.rs`, `windows.rs`). mpv's render API (OpenGL FBO,
D3D11 texture). The view passes its size with every frame, and a resize only gives a new target.
No change.

**Samsung TV** (`AvplaySurface.tsx`, `shell.js`). AVPlay draws on the TV's video plane at a
fixed 1920×1080 rectangle, letterboxed, under a page that is 1920×1080 as well. Nothing resizes.

## 2. Turns, resizes, split view

**A phone's interface never turns.** The window stays upright in every orientation (`ios_awake::
upright_on_phones` puts portrait in place of NSH's root controller's answer; the player's dialog
asks for nothing of its own). The system is never asked for a turn: the screen recording that
showed the player open upright, the whole window tilt with black corners, and Home tilt back on
close is gone with it.

**The player draws itself sideways** (`layout/TurnedBox.tsx`):

- Its root is a box of the window's size the other way round (852 × 393 in a 393 × 852 window),
  centred and turned ±90° with a style transform (a layer transform on iOS). Upright, the box is
  the window, with no transform.
- Everything in it lays out in the box's own coordinates: the video view, reel's subtitles, the
  controls, the stage, the drawers. What reads the window's size and insets for them reads the
  box's (`layout/surface.ts`, an NSH context: `chrome`'s side insets and so `theme.safe`, the
  drawers, the subtitles' fit). The screen's insets go to the sides they are on once turned:
  turned clockwise, the box's left is the screen's top (the Dynamic Island) and its right the
  screen's bottom (the home indicator).
- Touch: UIKit hit-tests through the transform. A press's position is in the pressed view's own
  coordinates and a pan's translation in its superview's, so both are the box's for every view in
  it. The swipe down to close is the player's `Pressable` inside the box: down is the box's down.
  NSH's headless tests do not apply transforms; the device or the simulator shows it.
- NSH's `Sheet` is a dialog of its own and shows the window's way up, so in the turned box the
  player's drawers (tracks, episodes) are drawn in place at the box's right (`Drawer`), the
  controls behind them hidden from VoiceOver and the swipe to close off while one is open. A
  dialog of the app's (pairing, an offered source) still shows upright over the player.
- Which way: turned clockwise (the phone turned counter-clockwise, the common way), or the other
  way when the device says it is held so (`VideoEngine.held`, UIKit's device orientation, read
  from its notifications). With the rotation lock on, iOS reports no turn and only Rotate turns
  the player; with it off, the player follows each turn of the device (upright or to either side).
  With VoiceOver on, the player turns only with Rotate: VoiceOver's gestures and reading order
  follow the real, upright screen.
- When: sideways at once as the player opens, before the picture is known (most films play
  sideways); upright again at load only for a picture taller than wide
  (`reel_domain::play::starts_sideways`), animated; either way with Rotate. The next episode
  keeps what the viewer chose. Closing needs nothing: the window was upright all along.
- A turn (Rotate, the device, the tall picture) lays the box out for the new angle at once and
  draws it at the old angle, scaled so that the picture is as large as it showed
  (`reel_domain::play::turn_start_scale`: ×0.56 to sideways for 16:9 on a 393 × 852 phone), then
  turns and scales it into place in 300 ms; the controls fade out meanwhile. Less motion asked
  for: at once. A drawer open as it turns closes.
- Sideways, the home indicator fades after a moment (`VideoEngine.immersive`:
  `prefersHomeIndicatorAutoHidden`); the status bar is hidden for the whole player (its dialog).
- **mpv is not called for a turn.** The video view's bounds change from 393 × 852 to 852 × 393;
  `layoutSubviews` of `ReelMpvView` fits the canvas again from its bounds (its own, unturned
  coordinates) and maps the film's subtitle margins again (§4). The canvas chosen at the hook was
  for the window in either orientation, so it stays.
- An iPad's window turns with the device as before: UIKit turns the scene, the video view's
  `layoutSubviews` fits the canvas again, and split view, Stage Manager and slide over take the
  same path. The canvas chosen at the hook stays when the window changes size later, so it is
  scaled.
- Android phones keep the system's rotation (their window turns when auto-rotate is on) and have
  no Rotate; drawing the player sideways there needs the activity kept upright first.

## 3. Lifecycle

- **First layout:** sets `wid` and `vo=gpu-next`, applies the 16:9 canvas and opens the
  `LoadGate`. Files wait for it because the canvas needs the window's size.
- **Next episode:** the player unmounts its video view while the next one resolves
  (`<If when={ready()}>`), so each episode gets a new view, a new mpv and its own hook. Only a new
  `src` in a view that stays reaches a kept output. There, if `C` changes, the hook replaces the
  output (`vo=null` → `gpu-next`) before setting `C`. No decoder exists yet at `on_preloaded`
  (the last file's is gone and the new one comes after), so nothing loses its frames. mpv rereads
  the size only when the frames' kind changes, so `C` never changes under a kept output.
- **Background / foreground:** stays `vid=no` / `vid=auto`. With no video track and no
  `force-window`, mpv drops its output and decoder, so nothing is drawn with the GPU in the
  background, which iOS forbids. The main thread waits for that teardown, which is needed before
  `didEnterBackground` returns. Back in front, `C` is set on the layer again (MoltenVK may have
  left 1×1), then `vid=auto`. A new decoder starts at a keyframe with mpv's own exact refresh
  seek, as a resume at open does, and `own_wait` keeps that wait from showing as buffering. This
  is the same kind of decoder re-creation the turn used to make, so it needs a device check
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
  - Styled ASS tracks keep their own placement (mpv's margins do not move them), as before.
- **reel's subtitles** (`SubtitleOverlay`, files from the release) are a view in the player's
  box. Their picture is the picture's aspect fitted into the box, the same box as the canvas, so
  both kinds line up. Where `C` is not the picture's aspect (unknown at the hook,
  or the container's size differs from the frames) mpv letterboxes inside `C`, and the two may
  differ by those bars.
- **Controls, the loading stage, the waiting line:** NSH views above the video view, in the
  player's box's coordinates (the window's, or the turned box's on a phone). The canvas does not
  change them.

## 5. Removed, costs, and what needs the device

Removed, iOS only:

- starting the output again on a new size (`vo=null` → `vo=gpu-next`);
- the keyframe seek after it;
- the size waiting for mpv's first frame and for a seek's place (`pending`,
  `restart_when_settled`, `Player::settled` / `when_shown`);
- the `seekWaiting` prop.

Costs accepted:

- In the orientation the picture is scaled down in, mpv draws more pixels than show: ×2–5 for
  a film upright on a phone. Below ×0.5 the scaled picture and its subtitles may shimmer.
- The layer is not opaque (libplacebo asks for alpha), so the compositor blends it.

To confirm on an iPhone (the simulator has no VideoToolbox, so it decodes on the CPU):

1. Open a film upright: it shows sideways at once, the window does not turn. Rotate several
   times, turn the phone by hand (the lock off), pause and turn. The picture stays, sound does
   not stutter, there is no jump back, and the log has `reel mpv: canvas …` lines only as a file
   opens (two: 16:9, then the picture's) and after the background, none on a turn. Close: Home
   is upright, with no tilt.
2. Back to the home screen mid-film for 10 s and return. The picture comes back, and the log
   should say `decoding with videotoolbox`, with no `hardware accelerator failed`. If decoding
   fails there, the fallback to try is `hwdec=videotoolbox-copy`. After that comes pausing in
   the background while keeping the video track and holding back redraws, though a frame drawn
   in the background could lose the GPU device for good.
3. A 2.39:1 film and a 4:3 one, sideways and upright: the picture is centred and sharp, and
   embedded subtitles sit inside the picture and above the controls.
