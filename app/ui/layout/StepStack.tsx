// The pages of a flow of steps (the first-run setup): on touch a native stack of its own (iOS's
// swipe back, Android's predictive back), one page per step reached, each kept with its state
// while it is under the one on top; elsewhere the current step's page alone. The flow owns
// which step is shown; a step the user went back from natively comes back as `onStep`.
import { effect, type JSX } from "nsh";
import { createNavStack, NavPage, NavStack } from "nsh/base";
import { caps } from "../platform";

const upTo = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);

export function StepStack(props: { step: () => number; onStep: (n: number) => void; page: (n: number) => JSX.Element }) {
  if (!caps.touch) {
    return (
      <Each of={[props.step()]} key={(n) => n}>
        {(n) => props.page(n())}
      </Each>
    );
  }
  const stack = createNavStack<number>(upTo(props.step()));
  // The step moved (Next, Back, a link that opens the source step): the stack follows.
  effect(() => {
    const want = upTo(props.step());
    const now = stack.routes();
    if (now.length !== want.length) stack.setRoutes(want);
  });
  return (
    <NavStack
      testID="step-stack"
      state={stack}
      style={{ flex: 1 }}
      // A swipe or the system's back popped a step; the stack's own changes say the same step.
      onChange={(e) => {
        const last = e.routes[e.routes.length - 1] ?? 0;
        if (last !== props.step()) props.onStep(last);
      }}
    >
      {(n) => (
        <NavPage headerVisible={false} statusBar={{ foreground: "light" }}>
          {props.page(n)}
        </NavPage>
      )}
    </NavStack>
  );
}
