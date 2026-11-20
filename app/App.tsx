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
import { effect, fpsEnabled, untracked, keymap, mount, setColorScheme, setFpsEnabled, UrlScheme, View } from "nsh";
import { setupWindow, WindowFrame } from "./ui/platform/window";
import { appDrawn, bindPlatformInput, mapPlatformKeys } from "./ui/platform/remote";
import { startDiagnostics } from "./ui/platform/diagnostics";
import { AboutScreen } from "./ui/screens/about/AboutScreen";
import { InterfaceScreen } from "./ui/screens/interface/InterfaceScreen";
import { TitleScreen } from "./ui/screens/title/TitleScreen";
import { PersonScreen } from "./ui/screens/person/PersonScreen";
import { TopLevel } from "./ui/screens/TopLevel";
import { back, canGoBack, closeFirst, go, handleBack, isRoot, liftSettings, route, section, stack, useHomeTab, useOwnSections, useTabStacks } from "./ui/nav";
import { screenFor } from "./ui/screens/RouteScreen";
import { chrome, frame } from "./ui/layout/chrome";
import { opening } from "./ui/library";
import { caps } from "./ui/platform";
import { railWidth } from "./ui/layout/metrics";
import { PhoneCategoryBar, PhoneTabBar, TabletEdgeBack, TabletTopRow } from "./ui/layout/TouchNav";
import { SourceDrawer } from "./ui/screens/source/SourceDrawer";
import { TouchStack } from "./ui/layout/TouchStack";
import { ExitDialog } from "./ui/layout/ExitDialog";
import { keysInUse } from "./ui/focus/keys";
import { Player } from "./ui/Player";
import { PlayerHost } from "./ui/layout/PlayerHost";
import { playerUp, status } from "./ui/playback";
import { loadSettings, setupDone } from "./ui/preferences";
import { SetupScreen } from "./ui/screens/setup/SetupScreen";
import { Hosted } from "./ui/native";
import { linkedSource } from "./ui/screens/source/sourceState";
import { openSourceDrawer } from "./ui/screens/source/SourceDrawer";
import { watchSettings } from "./ui/hosted";
import { PairingDialog } from "./ui/layout/PairingDialog";
import { OfferDialog } from "./ui/layout/OfferDialog";
import { colors } from "./ui/theme";
import { videoUnderUi } from "./ui/VideoSurface";

setColorScheme("dark");
// Keys the platform sends that the keymap does not know (a Samsung TV remote's Back).
mapPlatformKeys();
startDiagnostics();
// A phone and a tablet keep a stack per tab (design/navigation.md, "History model").
useTabStacks(caps.touch);
// A phone's Home tab holds the categories (design/navigation.md, "Phone"): a tablet's narrow
// window is laid out as a phone's, its Home tab too.
useHomeTab(() => frame().nav === "tab-bar");
// A tablet's Saved and Settings are sections of their own beside its tabs (design/navigation.md,
// "Tablet"); widened from a phone's layout, Settings opened on a tab leaves it for its own.
useOwnSections(() => frame().nav === "top-row");
effect(() => {
  if (frame().nav === "top-row") untracked(liftSettings);
});
// A link that opens the app (reel://s?t=<key>&u=<address>, from a partner's bot): its source
// fills the source's fields (the setup's step, else the drawer); nothing is saved until the
// viewer saves it. Any other link is dropped (anyone can make one).
UrlScheme.on("open", async ({ url }) => {
  let s: { url: string | null; key?: string } | null = null;
  try {
    // Awaited: the tests' stand-ins answer with a promise.
    s = JSON.parse(await Hosted.linkSource(url));
  } catch (e) {
    console.warn("reel: a link the core could not read", e);
  }
  if (!s?.url) return;
  linkedSource.set({ url: s.url, key: s.key ?? "" });
  if (setupDone() !== false) openSourceDrawer("link");
});
// Then follows the core's settings (changed on a phone too) and the pairing code it shows.
const settingsLoaded = loadSettings().catch((e) => console.warn("could not load settings", e));
settingsLoaded.then(watchSettings);

/** How long after the settings are in the app may still turn to Saved for want of a network, ms:
 * a late answer does not take the viewer off a page they are reading. */
const OPENING_WAIT = 15_000;
const OPENING_EVERY = 500;
/** Without a network at start, the app opens on Saved where something is saved to watch
 * (design/offline-downloads.md; the core decides: `Library.opening`). Asked until it knows, once
 * the settings are in and the setup is done, and only while the viewer is still on Home's top. */
settingsLoaded.then(() => {
  const until = Date.now() + OPENING_WAIT;
  const ask = () => {
    const s = stack();
    if (setupDone() === false || s.length !== 1 || s[0].name !== "home" || Date.now() > until) return;
    const where = opening();
    if (where === "saved") go("saved");
    else if (where === "wait") setTimeout(ask, OPENING_EVERY);
  };
  ask();
});

/** Android's system back on touch: what is open closes first; a pushed page
 * pops natively (the stack's own back); another tab's root goes Home; Home
 * leaves the app (the system's convention on phones). */
function systemBack(): boolean {
  if (closeFirst()) return true;
  if (canGoBack()) return false;
  if (section() !== "home") {
    back();
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
    <If when={r().name === "interface"}>
      <InterfaceScreen />
    </If>,
    // Keyed by the id: a title opened from another one (More like this) is a new screen.
    <Each of={r().name === "title" ? [(r() as { id: string }).id] : []} key={(id) => id}>
      {(id) => <TitleScreen id={id()} />}
    </Each>,
    // A person's page, keyed the same way (one opened from a title over another's).
    <Each of={r().name === "person" ? [(r() as { id: string }).id] : []} key={(id) => id}>
      {(id) => <PersonScreen id={id()} />}
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
  const playing = playerUp;

  return (
    // While a film plays under the UI (AVPlay on a TV), the app paints no background over it.
    <View
      style={{ flex: 1, backgroundColor: playing() && videoUnderUi() ? "transparent" : colors.ink() }}
      // The mouse's back button (button 4). A click or a touch hides the focus ring
      // until the keys drive again (focus/keys.ts).
      onMouseUp={(e) => {
        keysInUse.set(false);
        if (e.button === "back") handleBack();
      }}
      onTouchStart={() => keysInUse.set(false)}
    >
      {/* The first run: the setup takes the screen until it is done (the core says when). */}
      <If when={setupDone() === false}>
        <SetupScreen />
      </If>
      <If when={setupDone() !== false && !playing()} else={<If when={setupDone() !== false}><PlayerHost><Player /></PlayerHost></If>}>
        <If when={caps.touch} else={<OneScreen />}>
          {/* A tablet's window resized across a phone's width lays the pages out again from
              scratch (what they chose as they opened is the other family's). */}
          <Each of={[chrome()]} key={(c) => c}>
            {() => (
              <View style={{ flex: 1 }}>
                {/* Right of the phone's rail when it is held sideways. */}
                <View style={{ flex: 1, marginLeft: railWidth() }}>
                  <TouchStack page={screenFor} />
                </View>
                <If when={frame().nav === "tab-bar"}>
                  <PhoneCategoryBar />
                  <PhoneTabBar />
                </If>
                <If when={frame().nav === "top-row"}>
                  <TabletTopRow />
                  <TabletEdgeBack />
                </If>
              </View>
            )}
          </Each>
        </If>
      </If>
      {/* A desktop's window bar (the player's drag strips while a film plays). */}
      <WindowFrame playing={playing} />
      <ExitDialog />
      {/* Play with no search source: the drawer that asks for one. */}
      <SourceDrawer />
      {/* A phone pairing for the settings page: its code, over any screen. */}
      <PairingDialog />
      {/* A source a phone offers from a partner's link: a yes here saves it, over any screen. */}
      <OfferDialog />
    </View>
  );
}

mount(App);
// On the TV: the shell's splash goes once the first frame is drawn.
appDrawn();
