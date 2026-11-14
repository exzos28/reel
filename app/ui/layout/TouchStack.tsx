// The pages on touch: the current tab's native stack (NSH `NavStack`: iOS's
// swipe back, Android's predictive and system back). `nav.ts` stays where the
// history lives: the stack follows its routes, and a page the user went back
// from (a swipe, the system back) goes back into it. Each tab has its own
// stack state; switching tabs shows the other tab's.
import { effect, type JSX } from "nsh";
import { createNavStack, NavPage, NavStack, type NavStackState } from "nsh/base";
import { t } from "nsh/i18n";
import { title as titleOf, titleText } from "../catalog";
import { section, stack, type Destination, type Route } from "../nav";

const stacks = new Map<Destination, NavStackState<Route>>();
const same = (a: readonly Route[], b: readonly Route[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** The system header's back label leading back to `r`. */
function nameOf(r: Route): string {
  if (r.name === "title") {
    const s = titleOf(r.id);
    return s ? titleText(s) : t("nav.back");
  }
  return r.name === "about" ? t("settings.about.title") : t(`nav.${r.name}`);
}

/** One page: roots and titles draw their own top (the head, the back disc
 * over the hero), Settings and About take the system header, Settings with
 * a large title. */
function Page(props: { route: Route; children: JSX.Element }) {
  const r = props.route;
  const own = r.name !== "settings" && r.name !== "about";
  return (
    <NavPage
      headerVisible={!own}
      title={own ? undefined : r.name === "about" ? t("settings.about.title") : t("settings.title")}
      headerLargeTitle={r.name === "settings"}
      headerBackTitle={nameOf(r)}
    >
      {props.children}
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
      // The user went back natively (a swipe, the header's or the system's back).
      onChange={(e) => !same(e.routes, stack()) && stack.set([...e.routes])}
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
