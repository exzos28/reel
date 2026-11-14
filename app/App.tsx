// reel: the screens, driven by arrow keys, OK and Back like a remote (TV
// density on a TV, regular on a desktop and a tablet, compact on a phone) and
// by the mouse. On a TV and a desktop only one screen is mounted at a time, so
// only its keys are bound (a touch stack keeps the pages under the top one);
// the screens keep their focus in their own modules, so Back finds it again.
// The nav's destinations are the roots (screens/TopLevel.tsx); Back
// goes through one handler (ui/nav.ts `handleBack`), whatever key or button.
// The frame around the screens is the platform family's (layout/chrome.ts):
// on a desktop, one window bar over every page (layout/WindowBar.tsx); on
// touch, each tab's native stack with the phone's tab bar or the tablet's top
// row (layout/TouchStack.tsx, layout/TouchNav.tsx).
import { fpsEnabled, keymap, mount, setColorScheme, setFpsEnabled, View } from "nsh";
import { setupWindow, WindowFrame } from "./ui/platform/window";
import { appDrawn, bindPlatformInput, mapPlatformKeys } from "./ui/platform/remote";
import { startDiagnostics } from "./ui/platform/diagnostics";
import { AboutScreen } from "./ui/screens/about/AboutScreen";
import { TitleScreen } from "./ui/screens/title/TitleScreen";
import { TopLevel } from "./ui/screens/TopLevel";
import { canGoBack, closeFirst, go, handleBack, isRoot, route, section, useTabStacks } from "./ui/nav";
import { screenFor } from "./ui/screens/RouteScreen";
import { frame } from "./ui/layout/chrome";
import { caps } from "./ui/platform";
import { PhoneTabBar, TabletTopRow } from "./ui/layout/TouchNav";
import { TouchStack } from "./ui/layout/TouchStack";
import { ExitDialog } from "./ui/layout/ExitDialog";
import { Player } from "./ui/Player";
import { status } from "./ui/playback";
import { loadSettings } from "./ui/preferences";
import { colors } from "./ui/theme";
import { videoUnderUi } from "./ui/VideoSurface";

setColorScheme("dark");
// Keys the platform sends that the keymap does not know (a Samsung TV remote's Back).
mapPlatformKeys();
startDiagnostics();
// A phone and a tablet keep a stack per tab (design/navigation.md, "History model").
useTabStacks(caps.touch);
loadSettings().catch((e) => console.warn("could not load settings", e));

/** Android's system back on touch: what is open closes first; a pushed page
 * pops natively (the stack's own back); another tab's root goes Home; Home
 * leaves the app (the system's convention on phones). */
function systemBack(): boolean {
  if (closeFirst()) return true;
  if (canGoBack()) return false;
  if (section() !== "home") {
    go("home");
    return true;
  }
  return false;
}

/** The screens on a TV and a desktop: the top route only. */
function OneScreen() {
  const r = route;
  return [
    <If when={isRoot(r().name)}>
      <TopLevel />
    </If>,
    <If when={r().name === "about"}>
      <AboutScreen />
    </If>,
    // Keyed by the id: a title opened from another one (More like this) is a new screen.
    <Each of={r().name === "title" ? [(r() as { id: string }).id] : []} key={(id) => id}>
      {(id) => <TitleScreen id={id()} />}
    </Each>,
  ];
}

function App() {
  // ⌘⇧F (Ctrl+Shift+F elsewhere): NSH's performance monitor, to see where frames drop.
  keymap.bind("mod+shift+f", () => setFpsEnabled(!fpsEnabled()));
  // A desktop's window has no system title bar: the window bar is reel's own.
  setupWindow();
  // Back: Escape (a TV remote's Back arrives as Escape), through what is open first.
  keymap.bind({ escape: handleBack });
  // The platform's own: a desktop's shortcuts and menu, Android's system back.
  bindPlatformInput({ back: handleBack, systemBack, go });
  const playing = () => status().phase !== "idle";

  return (
    // While a film plays under the UI (AVPlay on a TV), the app paints no background over it.
    <View
      style={{ flex: 1, backgroundColor: playing() && videoUnderUi() ? "transparent" : colors.ink() }}
      // The mouse's back button (button 4).
      onMouseUp={(e) => e.button === "back" && handleBack()}
    >
      <If when={!playing()} else={<Player />}>
        <If when={caps.touch} else={<OneScreen />}>
          <TouchStack page={screenFor} />
        </If>
        <If when={frame.nav === "tab-bar"}>
          <PhoneTabBar />
        </If>
        <If when={frame.nav === "top-row"}>
          <TabletTopRow />
        </If>
      </If>
      {/* A desktop's window bar (the player's drag strips while a film plays). */}
      <WindowFrame playing={playing} />
      <ExitDialog />
    </View>
  );
}

mount(App);
// On the TV: the shell's splash goes once the first frame is drawn.
appDrawn();
