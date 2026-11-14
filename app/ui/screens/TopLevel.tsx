// The top-level screens (Home, Movies, Shows, Anime). Each has the same nav at
// the top of its content (layout/Screen), scrolling with the page.
import { View } from "nsh";
import { route, type Destination } from "../nav";
import { BrowseScreen } from "./browse/BrowseScreen";
import { HomeScreen } from "./home/HomeScreen";

const TOP_LEVEL: Destination[] = ["home", "movies", "shows", "anime"];

/** Whether `name` is a screen under the shared nav. */
export const isTopLevel = (name: string) => TOP_LEVEL.includes(name as Destination);

export function TopLevel() {
  const current = () => route().name as Destination;
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
      <If when={current() === "anime"}>
        <BrowseScreen page="anime" />
      </If>
    </View>
  );
}
