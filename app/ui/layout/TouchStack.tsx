// The pages on touch: the current tab's native stack (NSH `NavStack`: iOS's
// swipe back, Android's predictive and system back). `nav.ts` stays where the
// history lives: the stack follows its routes, and a page the user went back
// from (a swipe, the system back) goes back into it. Each tab has its own
// stack state; switching tabs shows the other tab's.
import { effect, type JSX } from "nsh";
import { createNavStack, NavPage, NavStack, type NavStackState } from "nsh/base";
import { section, stack, type Destination, type Route } from "../nav";
import { PageRoute } from "./frameState";

const stacks = new Map<Destination, NavStackState<Route>>();
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
  let state = stacks.get(props.tab);
  if (!state) {
    state = createNavStack<Route>([...stack()]);
    stacks.set(props.tab, state);
  }
  const s = state;
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
      // The user went back natively (a swipe, the header's or the system's back). Only the
      // current tab's stack writes the history: a pop a tab's stack reports once another tab is
      // shown (iOS reports one when its transition ends) must not put that tab's pages in it.
      onChange={(e) => section() === props.tab && !same(e.routes, stack()) && stack.set([...e.routes])}
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
