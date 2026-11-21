// Play pressed: it answers at once. The core says what it does (`onPlay`): with no search source
// the drawer that adds one opens, when the source did not answer the drawer to fix it; else the
// player opens now, the release known or not: the engine waits for the search inside it ("Looking
// for a release") and plays what it finds. What the search turns out to be meanwhile is the
// engine's to say: the source did not answer (the drawer to fix it, SourceDrawer), nothing found
// (the player says so).
import { onPlay, type Summary } from "../../catalog";
import { openSourceDrawer } from "./SourceDrawer";

/** `title`: what Play plays, as its card or its page has it; `start`: play it. */
export function pressPlay(title: Pick<Summary, "notice" | "play">, start: () => void) {
  // Still a stand-in (the page's title is on its way): nothing to play yet.
  if (title.notice) return;
  const now = onPlay(title.play.id);
  if (now === "no_source") return openSourceDrawer("missing");
  if (now === "failed") return openSourceDrawer("failed");
  start();
}
