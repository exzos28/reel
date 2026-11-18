// The nav's destinations (Home, Movies, Series, Cartoons, Anime, Search, Settings): the
// roots of the history, one shown at a time.
import { View } from "nsh";
import { route } from "../nav";
import { BrowseScreen } from "./browse/BrowseScreen";
import { HomeScreen } from "./home/HomeScreen";
import { SearchScreen } from "./search/SearchScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { SavedScreen } from "./saved/SavedScreen";

export function TopLevel() {
  const current = () => route().name;
  return (
    <View style={{ flex: 1 }}>
      <If when={current() === "home"}>
        <HomeScreen />
      </If>
      <If when={current() === "movies"}>
        <BrowseScreen page="movies" />
      </If>
      <If when={current() === "shows"}>
        <BrowseScreen page="shows" />
      </If>
      <If when={current() === "cartoons"}>
        <BrowseScreen page="cartoons" />
      </If>
      <If when={current() === "anime"}>
        <BrowseScreen page="anime" />
      </If>
      <If when={current() === "search"}>
        <SearchScreen />
      </If>
      <If when={current() === "settings"}>
        <SettingsScreen />
      </If>
      <If when={current() === "saved"}>
        <SavedScreen />
      </If>
    </View>
  );
}
