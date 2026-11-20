// What a press shows: a control dims from the moment a finger is down and stays dimmed at least
// MIN_MS, so a quick tap shows too (a state style alone lasts only as long as the press: a tap's
// few milliseconds never reach the screen).
import { signal } from "nsh";

const MIN_MS = 140;

export function pressFeedback() {
  const lit = signal(false);
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Dimmed now. */
    on: lit,
    onPressDown: () => {
      clearTimeout(timer);
      since = Date.now();
      lit.set(true);
    },
    onPressUp: () => {
      clearTimeout(timer);
      timer = setTimeout(() => lit.set(false), Math.max(0, MIN_MS - (Date.now() - since)));
    },
  };
}
