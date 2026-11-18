// The screen of one route, for the touch stack (layout/TouchStack.tsx), where
// every page in a tab's stack is mounted, not only the top one.
import type { Route } from "../nav";
import { AboutScreen } from "./about/AboutScreen";
import { BrowseScreen } from "./browse/BrowseScreen";
import { HomeScreen } from "./home/HomeScreen";
import { SearchScreen } from "./search/SearchScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SavedScreen } from "./saved/SavedScreen";
import { TitleScreen } from "./title/TitleScreen";

export function screenFor(r: Route) {
  switch (r.name) {
    case "home":
      return <HomeScreen />;
    case "movies":
    case "shows":
    case "cartoons":
    case "anime":
      return <BrowseScreen page={r.name} />;
    case "search":
      return <SearchScreen />;
    case "settings":
      return <SettingsScreen />;
    case "saved":
      return <SavedScreen />;
    case "about":
      return <AboutScreen />;
    case "title":
      return <TitleScreen id={r.id} />;
  }
}
