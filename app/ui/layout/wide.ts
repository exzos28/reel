// How a tablet's pages use its width (design/navigation.md, "Tablet"): held wide, an iPad's
// content is over 1100 points across, too long for one column of rows or lines of text. The
// screens ask these decisions, not the family; a phone, a TV and a computer keep their layouts.
import { windowSize } from "nsh";
import { chrome, sideInset } from "./chrome";

const tablet = () => chrome() === "tablet";
/** Held wide: content 1000 points across or more (an iPad's landscape, not its portrait). */
const wide = () => tablet() && windowSize().width - 2 * sideInset() >= 1000;

/** A show's episodes in two columns. */
export const episodeColumns = () => (wide() ? 2 : 1);
/** About and Details side by side, each no longer than `TEXT_MAX`. */
export const aboutBesideDetails = wide;
/** The longest a block of text runs beside another, points. */
export const TEXT_MAX = 760;
/** Settings' rows a column in the middle. */
export const centredForm = wide;
/** Saved's ready films and shows as a grid of cards (elsewhere rows). */
export const savedCards = tablet;
/** Search's results as a grid of cards with Show all (elsewhere rows of cards that scroll sideways). */
export const searchGrid = tablet;
/** Columns of a tablet's grid of cards: four held wide, three upright. */
export const cardColumns = () => (wide() ? 4 : 3);
