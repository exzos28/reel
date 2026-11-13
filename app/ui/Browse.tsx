// Movies and Shows: page title, a trending row of posters, the filter
// pills (static for now) and a grid of 16:9 cards. Remote: the focus starts
// on the first poster; Up from the row goes to the nav; the grid moves by
// rows and columns. OK opens the title. Back goes Home.
import { computed, keymap, signal, Text, View, windowSize, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import { airsText, browse, cardMeta, titleText, type Summary } from "./catalog";
import { BackButton, CardMeta, Icon, NAV, NavBar, Picture } from "./components";
import { byKeys, Scroller, scroller } from "./Scroller";
import { back, go, openTitle } from "./nav";
import { alpha, colors, focusRing, font, radius, ringRoom, safe, type, u } from "./theme";
import chevronIcon from "./icons/chevron.svg";

type Page = "movies" | "shows";
type Zone = "nav" | "trending" | "grid";

/** Per page, kept while other screens show. */
const state = {
  movies: { zone: signal<Zone>("trending"), nav: signal(1), trend: signal(0), cell: signal(0) },
  shows: { zone: signal<Zone>("trending"), nav: signal(2), trend: signal(0), cell: signal(0) },
};

export function Browse(props: { page: Page }) {
  const data = computed(() => browse(props.page));
  const { zone, nav, trend, cell } = state[props.page];
  /** Cards per grid row: as many as fit at about 330 TV pixels each. */
  const columns = computed(() => {
    const width = windowSize().width - 2 * safe().x;
    return Math.max(2, Math.floor((width + u(24)) / (u(326) + u(24))));
  });
  const cardWidth = () => (windowSize().width - 2 * safe().x - (columns() - 1) * u(24)) / columns();
  const rows = computed(() => {
    const all = data().all;
    const out: { at: number; items: Summary[] }[] = [];
    for (let i = 0; i < all.length; i += columns()) out.push({ at: i, items: all.slice(i, i + columns()) });
    return out;
  });
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

  /** The page puts the focused grid row in its upper third; the trending
   * row puts the focused poster at the left edge of its inset. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });
  const line = scroller({ horizontal: true, anchor: () => safe().x });

  keymap.bind(
    byKeys({
      left: () => {
        if (zone() === "nav") nav.set(clamp(nav() - 1, NAV.length - 1));
        else if (zone() === "trending") trend.set(clamp(trend() - 1, data().trending.length - 1));
        else if (cell() % columns() > 0) cell.set(cell() - 1);
      },
      right: () => {
        if (zone() === "nav") nav.set(clamp(nav() + 1, NAV.length - 1));
        else if (zone() === "trending") trend.set(clamp(trend() + 1, data().trending.length - 1));
        else if (cell() % columns() < columns() - 1 && cell() + 1 < data().all.length) cell.set(cell() + 1);
      },
      up: () => {
        if (zone() === "trending") zone.set("nav");
        else if (zone() === "grid") cell() < columns() ? zone.set("trending") : cell.set(cell() - columns());
      },
      down: () => {
        if (zone() === "nav") zone.set("trending");
        else if (zone() === "trending") {
          zone.set("grid");
          cell.set(clamp(cell() % columns(), data().all.length - 1));
        } else if (cell() + columns() < data().all.length) cell.set(cell() + columns());
      },
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (zone() === "nav") go(NAV[nav()].id);
      else if (zone() === "trending") openTitle(data().trending[trend()].id);
      else openTitle(data().all[cell()].id);
    },
    escape: back,
  });

  return (
    <Scroller ctl={page} style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View style={{ paddingBottom: safe().y }}>
        <View ref={page.follow(() => zone() === "nav", "start")}>
          <NavBar current={props.page} focused={() => (zone() === "nav" ? nav() : null)} onPick={(i) => go(NAV[i].id)} />
        </View>
        <View style={{ paddingHorizontal: safe().x, marginTop: u(24) }}>
          <Text style={{ ...type.page(), color: colors.snow() }}>{t(`browse.${props.page}.title`)}</Text>
          <Text style={{ ...type.body(), color: colors.ash(), marginTop: u(8) }}>{t(`browse.${props.page}.lead`)}</Text>
          <Text style={{ ...type.section(), color: colors.snow(), marginTop: u(34) }}>{t(`browse.${props.page}.trending`)}</Text>
        </View>
        <View ref={page.follow(() => zone() === "trending", "nearest")}>
        <Scroller ctl={line}>
          <View style={{ flexDirection: "row", gap: u(20), paddingHorizontal: safe().x, paddingTop: Math.max(u(26), ringRoom()), paddingBottom: Math.max(u(16), ringRoom()) }}>
            <Each of={data().trending} key={(s) => s.id}>
              {(item, i) => (
                <PosterCard
                  item={item}
                  sub={() => (props.page === "shows" ? airsText(item()) : null)}
                  focused={() => zone() === "trending" && trend() === i()}
                  follow={line.follow}
                  onPress={() => {
                    zone.set("trending");
                    trend.set(i());
                    openTitle(item().id);
                  }}
                />
              )}
            </Each>
          </View>
        </Scroller>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: u(12), paddingHorizontal: safe().x, marginTop: u(26) }}>
          <Text style={{ ...type.section(), color: colors.snow(), marginRight: u(22) }}>{t(`browse.${props.page}.all`)}</Text>
          <Each of={["genres", "years", "countries"]} key="index">
            {(f) => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: u(8), height: u(46), paddingHorizontal: u(18), borderRadius: radius(), borderCurve: "continuous", backgroundColor: colors.card() }}>
                <Text style={{ ...type.meta(), color: colors.soft() }}>{t(`browse.filter.${f()}`)}</Text>
                <Icon src={() => chevronIcon} size={18} color={colors.ash} />
              </View>
            )}
          </Each>
          <View style={{ flex: 1 }} />
          <Text style={{ ...type.meta(), color: colors.ash() }}>
            {`${t("browse.sort")} `}
            <Text style={{ fontWeight: 500, color: colors.snow() }}>{t("browse.popular")}</Text>
          </Text>
        </View>
        <View style={{ paddingHorizontal: safe().x, marginTop: u(20), gap: u(28) }}>
          <Each of={rows()} key={(r) => r.at}>
            {(r) => (
              <View
                ref={page.follow(() => zone() === "grid" && cell() >= r().at && cell() < r().at + r().items.length)}
                style={{ flexDirection: "row", gap: u(24) }}
              >
                <Each of={r().items} key={(s) => s.id}>
                  {(item, c) => (
                    <GridCard
                      item={item}
                      width={cardWidth}
                      focused={() => zone() === "grid" && cell() === r().at + c()}
                      onPress={() => {
                        zone.set("grid");
                        cell.set(r().at + c());
                        openTitle(item().id);
                      }}
                    />
                  )}
                </Each>
              </View>
            )}
          </Each>
        </View>
      </View>
    </Scroller>
  );
}

/** A 2:3 poster with the title and a line under it. */
function PosterCard(props: {
  item: () => Summary;
  sub: () => string | null;
  focused: () => boolean;
  follow: (when: () => boolean) => (r: ViewRef) => void;
  onPress: () => void;
}) {
  const s = props.item;
  return (
    <View
      ref={props.follow(props.focused)}
      role="button"
      accessibilityLabel={titleText(s())}
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.92 }}
      style={{ width: u(196), flexShrink: 0, gap: u(3) }}
    >
      <View style={{ borderRadius: radius(), borderCurve: "continuous", ...focusRing(props.focused(), "card") }}>
        <Picture item={s} src={() => s().poster} titleSize={22} style={{ height: u(290), borderRadius: radius(), borderCurve: "continuous" }} />
      </View>
      <Text style={{ numberOfLines: 1, fontFamily: font, fontSize: u(21), fontWeight: 600, color: colors.snow(), marginTop: u(12) }}>
        {titleText(s())}
      </Text>
      <If when={props.sub()} else={<CardMeta text={() => cardMeta(s())} size={20} />}>
        <Text style={{ numberOfLines: 1, ...type.small(), color: colors.ash() }}>{props.sub()}</Text>
      </If>
    </View>
  );
}

/** A 16:9 card with the title over the still and an optional red tag. */
function GridCard(props: { item: () => Summary; width: () => number; focused: () => boolean; onPress: () => void }) {
  const s = props.item;
  return (
    <View
      role="button"
      accessibilityLabel={titleText(s())}
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.92 }}
      style={{ width: props.width(), gap: u(3) }}
    >
      <View style={{ borderRadius: radius(), borderCurve: "continuous", ...focusRing(props.focused(), "card") }}>
        <Picture item={s} src={() => s().still} titleSize={20} style={{ height: props.width() * 0.56, borderRadius: radius(), borderCurve: "continuous" }} />
        <If when={s().still}>
          <View
            style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius(), borderCurve: "continuous",
              backgroundImage: `linear-gradient(0deg, ${alpha(colors.ink(), 0.85)} 0%, ${alpha(colors.ink(), 0)} 55%)`,
            }}
          />
          <Text
            style={{ numberOfLines: 2, ...type.logotype(20), fontWeight: 300, color: colors.snow(), position: "absolute", left: u(16), right: u(16), bottom: u(14) }}
          >
            {titleText(s())}
          </Text>
        </If>
        <If when={s().tag}>
          <View style={{ position: "absolute", left: u(12), top: u(12), backgroundColor: colors.red(), borderRadius: u(4), borderCurve: "continuous", paddingHorizontal: u(9), paddingVertical: u(6) }}>
            <Text style={{ fontFamily: font, fontSize: u(17), fontWeight: 600, color: colors.snow() }}>{t(`tag.${s().tag}`)}</Text>
          </View>
        </If>
      </View>
      <Text style={{ numberOfLines: 1, fontFamily: font, fontSize: u(22), fontWeight: 600, color: colors.snow(), marginTop: u(12) }}>
        {titleText(s())}
      </Text>
      <CardMeta text={() => cardMeta(s())} size={20} />
    </View>
  );
}

/** Search: not built yet; says so and offers Back. */
export function Search() {
  keymap.bind({ escape: back, enter: back });
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink(), paddingHorizontal: safe().x, paddingTop: safe().y, gap: u(32) }}>
      <BackButton focused={() => true} onPress={back} />
      <Text style={{ ...type.page(), color: colors.snow() }}>{t("search.title")}</Text>
      <Text style={{ ...type.body(), color: colors.ash(), maxWidth: u(1000) }}>{t("search.soon")}</Text>
    </View>
  );
}
