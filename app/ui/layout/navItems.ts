// The nav's destinations, in the order the remote walks them.
import type { ImageAsset } from "nsh";
import type { Destination } from "../nav";
import homeIcon from "../icons/home.svg";
import moviesIcon from "../icons/movies.svg";
import showsIcon from "../icons/shows.svg";
import searchIcon from "../icons/search.svg";
import settingsIcon from "../icons/settings.svg";

/** `pill`: in the pill group; otherwise a round button after it. */
export const NAV: { id: Destination; icon: ImageAsset; pill: boolean }[] = [
  { id: "home", icon: homeIcon, pill: true },
  { id: "movies", icon: moviesIcon, pill: true },
  { id: "shows", icon: showsIcon, pill: true },
  { id: "search", icon: searchIcon, pill: false },
  { id: "settings", icon: settingsIcon, pill: false },
];
