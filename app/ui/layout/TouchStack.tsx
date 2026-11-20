// The pages on touch: the current tab's native stack (NSH `NavStack`: iOS's
// swipe back, Android's predictive and system back). `nav.ts` stays where the
// history lives: the stack follows its routes, and a page the user went back
// from (a swipe, the system back) goes back into it. Each tab shown gets a
// native stack of its own, made from that tab's routes.
import { effect, signal, untracked, View, type JSX } from "nsh";
import { createNavStack, NavPage, NavStack } from "nsh/base";
import { keepTab, section, stack, type Destination, type Route } from "../nav";
import { PageRoute } from "./frameState";

const same = (a: readonly Route[], b: readonly Route[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** How long a tab's stack stays mounted (hidden) once another tab is shown, ms: a swipe back
 * the viewer let go of just before choosing the tab reports its pop when its transition ends,
 * and the tab's kept stack must hear it (else the page comes back on return). */
const LINGER = 1000;

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

/** A tab's stack, mounted where it is shown. */
interface Shown {
  tab: Destination;
  /** Its first route: a new one (a category picked from its top) is a new stack. */
  root: Route;
}

function TabStack(props: { tab: Destination; shown: () => boolean; page: (r: Route) => JSX.Element }) {
  // Made with the tab's first page only, the rest set once the native stack is up: iOS's swipe
  // back did not start on a stack made with several pages until a page was pushed or popped.
  const s = createNavStack<Route>([stack()[0]]);
  const up = signal(false);
  setTimeout(() => up.set(true), 0);
  // The history moved (a push, Back, a tab chosen again): the stack follows.
  effect(() => {
    const routes = stack();
    if (up() && section() === props.tab && !same(s.routes(), routes)) s.setRoutes([...routes]);
  });
  return (
    <View style={{ flex: 1, display: props.shown() ? "flex" : "none" }}>
      <NavStack
        testID={props.shown() ? "touch-stack" : undefined}
        state={s}
        style={{ flex: 1 }}
        // The user went back natively (a swipe, the header's or the system's back). A pop a tab's
        // stack reports once another tab is shown (iOS reports one when its transition ends) goes
        // to that tab's kept stack, never into the history shown.
        onChange={(e) => !(section() === props.tab && same(e.routes, stack())) && keepTab(props.tab, [...e.routes])}
      >
        {(r) => <Page route={r}>{props.page(r)}</Page>}
      </NavStack>
    </View>
  );
}

export function TouchStack(props: { page: (r: Route) => JSX.Element }) {
  const current = (): Shown => ({ tab: section(), root: stack()[0] });
  /** The tab shown, and the one left a moment ago (`LINGER`), hidden. */
  const left = signal<Shown | null>(null);
  let shown = untracked(current);
  let timer: number | undefined;
  const mounted = signal<Shown[]>([shown]);
  effect(() => {
    const now = current();
    if (now.tab === shown.tab && now.root === shown.root) return;
    untracked(() => {
      const keep = left();
      // The tab left a moment ago shown again: its stack, still up.
      const back = keep && keep.tab === now.tab && keep.root === now.root ? keep : now;
      left.set(shown.tab === back.tab ? null : shown);
      shown = back;
      mounted.set([shown, ...(left() ? [left()!] : [])]);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        left.set(null);
        mounted.set([shown]);
      }, LINGER);
    });
  });
  return (
    <Each of={mounted()} key={(m) => m}>
      {(m) => <TabStack tab={m().tab} shown={() => m() === mounted()[0]} page={props.page} />}
    </Each>
  );
}
