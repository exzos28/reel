// Play as a press that waits for the search source: with no source it opens the drawer that
// adds one; with one it waits for the title's release and plays it once it is known; if the
// source does not answer it opens the drawer to fix it; if it found nothing it stops (the line
// under Play says so).
import { effect, signal, untracked } from "nsh";
import type { Title } from "../../catalog";
import { openSourceDrawer } from "./SourceDrawer";

/** `title`: the title as its page has it (asking for it starts the search); `start`: play it. */
export function playGate(title: () => Title | null | undefined, start: () => void) {
  const pending = signal(false);
  effect(() => {
    if (!pending()) return;
    const t = title();
    if (!t) return;
    const done = (then?: () => void) => {
      pending.set(false);
      if (then) untracked(then);
    };
    if (!t.playable || t.releasesState === "no_source") return done(() => openSourceDrawer("missing"));
    if (t.release) return done(start);
    if (t.releasesState === "failed") return done(() => openSourceDrawer("failed"));
    if (t.releasesState === "none" || t.releasesState === "done") return done();
  });
  return {
    /** Play pressed: it plays now or once the release is known. */
    press: () => pending.set(true),
    /** Waiting for the source's answer. */
    pending,
  };
}
