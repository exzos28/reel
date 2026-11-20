// The pages on touch: the current tab's native stack (NSH `NavStack`: iOS's
// swipe back, Android's predictive and system back). `nav.ts` stays where the
// history lives: the stack follows its routes, and a page the user went back
// from (a swipe, the system back) goes back into it. Each tab shown gets a
// native stack of its own, made from that tab's routes.
import { effect, type JSX } from "nsh";
import { createNavStack, NavPage, NavStack } from "nsh/base";
import { keepTab, section, stack, type Destination, type Route } from "../nav";
import { PageRoute } from "./frameState";

const same = (a: readonly Route[], b: readonly Route[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** One page. reel draws every page's top itself (the frame: the head, Back, the discs over a
 * hero), the same on every page, so the system header never shows; the native stack keeps
 * its back gestures. The page knows its route (`PageRoute`): only the page on top sets the
 * frame's state. The status bar stays light: reel is dark. */
function Page(props: { route: Route; children: JSX.Element }) {
  return (
    <NavPage headerVisible={false} statusBar={{ foreground: "light" }}>
      <PageRoute.Provider value={props.route}>{props.children}</PageRoute.Provider>
    </NavPage>
  );
}

function TabStack(props: { tab: Destination; page: (r: Route) => JSX.Element }) {
  // A new state each time the tab is shown, from its routes in the history (nav.ts keeps each
  // tab's): a state kept from the tab's last showing belongs to a native stack that is gone,
  // and the one now shown did not pop to it (a tab chosen again stayed on its page).
  const s = createNavStack<Route>([...stack()]);
  // The history moved (a push, Back, a tab chosen again): the stack follows.
  effect(() => {
    const routes = stack();
    if (section() === props.tab && !same(s.routes(), routes)) s.setRoutes([...routes]);
  });
  return (
    <NavStack
      testID="touch-stack"
      state={s}
      style={{ flex: 1 }}
      // The user went back natively (a swipe, the header's or the system's back). A pop a tab's
      // stack reports once another tab is shown (iOS reports one when its transition ends) goes
      // to that tab's kept stack, never into the history shown.
      onChange={(e) => !(section() === props.tab && same(e.routes, stack())) && keepTab(props.tab, [...e.routes])}
    >
      {(r) => <Page route={r}>{props.page(r)}</Page>}
    </NavStack>
  );
}

export function TouchStack(props: { page: (r: Route) => JSX.Element }) {
  return (
    <Each of={[section()]} key={(tab) => tab}>
      {(tab) => <TabStack tab={tab()} page={props.page} />}
    </Each>
  );
}
