// The top-level screens (Home, Movies, Shows) under the one shared nav: the
// screen changes, the nav stays mounted where it is.
import { View } from "nsh";
import { NavLayer } from "../layout/NavLayer";
import { route, type Destination } from "../nav";
import { BrowseScreen } from "./browse/BrowseScreen";
import { HomeScreen } from "./home/HomeScreen";

const TOP_LEVEL: Destination[] = ["home", "movies", "shows"];

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
      <NavLayer current={current} />
    </View>
  );
}
