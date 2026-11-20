// Back on a nav destination (design/navigation.md, "TV" and "Desktop"). On a
// TV: the focus not on the nav → the page goes to its top and the focus to
// the page's item in the nav; on the nav → Home, its item focused; on Home's
// nav → "Exit reel?". On a desktop the nav is always in view, so Back stops at
// a root. On touch the system's rule applies (another tab → Home; Home →
// leave), as one level up does.
import { exitAsked } from "../layout/ExitDialog";
import { frame } from "../layout/chrome";
import { forgetScroll, type ScrollCtl } from "../layout/scrollCtl";
import { go, onPageBack, section, takeChosenInNav } from "../nav";
import { navAt as homeNavAt, zone as homeZone } from "../screens/home/focus";

export function useRootBack(page: { ctl: ScrollCtl; onNav: () => boolean; toNav: () => void }) {
  // Chosen in the nav with the keys: the focus stays there, on this page's item.
  if (takeChosenInNav(section())) page.toNav();
  onPageBack(() => {
    if (frame().nav === "window-bar") return true;
    if (frame().nav !== "page") return false;
    if (!page.onNav()) {
      page.ctl.scroll()?.scrollTo({ y: 0, animated: true });
      page.toNav();
    } else if (section() !== "home") {
      homeZone.set("nav");
      homeNavAt.set(0);
      forgetScroll("home");
      go("home");
    } else exitAsked.set(true);
    return true;
  });
}
