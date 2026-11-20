// A person of a title's cast: their photo and name as the page's title, then the films and
// series they are in, the best known first (the core's order), as Films' grid shows titles.
// Remote: the focus starts on the first title; the arrows walk the grid; OK opens the title.
// Back goes one level up (the title the person was opened from); coming back from a title
// finds the focus where it was.
import { computed, Image, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { person, type PersonPage, type Summary } from "../../catalog";
import { clamp } from "../../focus/memory";
import { useZones } from "../../focus/zones";
import { metaText, fontText } from "../../kit/text";
import { cellWidth, Grid, GRID_GAP, GRID_ROW_GAP, gridColumnsNow, gridRows } from "../../layout/Grid";
import { PageFrame } from "../../layout/PageFrame";
import { SectionTitle } from "../../layout/Section";
import { scroller } from "../../layout/Scroller";
import { openTitle, stack } from "../../nav";
import { colors, safe, u } from "../../theme";
import { GridCard } from "../browse/GridCard";
import { signal } from "nsh";

const PHOTO = 132;

const discStyle = (): ViewStyle => ({
  width: u(PHOTO), height: u(PHOTO), borderRadius: u(PHOTO), overflow: "hidden", flexShrink: 0,
  backgroundColor: colors.card(), alignItems: "center", justifyContent: "center",
});
const photoStyle = { width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" } as ImageStyle;
const lineStyle = (): TextStyle => ({ ...metaText(), paddingHorizontal: safe().x, marginTop: u(24) });

/** The focused title of each person's page still under the one shown, by its place in the
 * history and its id ("2:tmdb:person:6384"). */
const kept = new Map<string, number>();

/** The photo, or the initials on a plain disc. */
function Photo(props: { page: () => PersonPage }) {
  const p = props.page;
  return (
    <View style={discStyle()}>
      <If when={p().photo} else={<Text style={fontText(40, colors.ash(), 300)}>{p().initials}</Text>}>
        <Image src={p().photo!} style={photoStyle} />
      </If>
    </View>
  );
}

export function PersonScreen(props: { id: string }) {
  const data = computed(() => person(props.id));
  const items = () => data().items;
  const depth = stack().length - 1;
  const key = `${depth}:${props.id}`;
  // Only pages still under this one are come back to.
  for (const k of kept.keys()) if (Number(k.split(":")[0]) > depth) kept.delete(k);
  const cell = signal(kept.get(key) ?? 0);
  const columns = computed(() => gridColumnsNow());
  const rows = computed(() => gridRows<Summary>(items(), columns()));
  const count = () => items().length;

  const open = (at: number) => {
    cell.set(at);
    kept.set(key, at);
    openTitle(items()[at].id);
  };

  /** The page puts the focused grid row in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });
  useZones(() => "grid" as const, {
    grid: {
      left: () => cell() % columns() > 0 && cell.set(cell() - 1),
      right: () => cell() % columns() < columns() - 1 && cell() + 1 < count() && cell.set(cell() + 1),
      up: () => cell() >= columns() && cell.set(cell() - columns()),
      down: () => cell() + columns() < count() && cell.set(cell() + columns()),
      enter: () => count() > 0 && open(clamp(cell(), count() - 1)),
    },
  });

  /** A line instead of the grid: still loading, the source did not answer, or no titles. */
  const stateText = () => {
    const s = data().state;
    if (s !== "done") return t(`person.state.${s}`);
    return count() === 0 ? t("person.state.none") : "";
  };
  const focusedAt = () => clamp(cell(), Math.max(count() - 1, 0));

  return (
    <PageFrame ctl={page} kind="deep" title={() => data().name} titleLead={() => <Photo page={data} />}>
      <View style={{ marginTop: u(48) }}>
        <SectionTitle text={() => t("person.titles")} inset />
      </View>
      <If when={stateText()}>
        <Text style={lineStyle()}>{stateText()}</Text>
      </If>
      <Grid
        rows={rows}
        key={(s) => s.id}
        top={20}
        rowGap={GRID_ROW_GAP}
        gap={GRID_GAP}
        rowRef={(r) => page.follow(() => focusedAt() >= r().at && focusedAt() < r().at + r().items.length)}
        page={page}
        focusRow={() => Math.floor(focusedAt() / columns())}
        cell={(item, at) => (
          <GridCard item={item} width={() => cellWidth(columns(), GRID_GAP)} focused={() => focusedAt() === at()} onPress={() => open(at())} />
        )}
      />
    </PageFrame>
  );
}
