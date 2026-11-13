// The pieces every screen shares: buttons, badges, the nav, the hero, card
// images with their typographic fallback. Only rendering; state comes in
// as accessors.
import { effect, Image, Text, View, type ImageAsset, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import {
  aboutText, badgeText, genresText, lengthText, releaseLine, titleText, yearsText, type Summary,
} from "./catalog";
import type { Destination } from "./nav";
import { alpha, colors, density, focusRing, font, heroFade, radius, safe, type, u } from "./theme";
import homeIcon from "./icons/home.svg";
import moviesIcon from "./icons/movies.svg";
import showsIcon from "./icons/shows.svg";
import searchIcon from "./icons/search.svg";
import settingsIcon from "./icons/settings.svg";
import backIcon from "./icons/back.svg";

/** A ref that scrolls its view into sight whenever `focused` turns true. */
export function revealWhen(focused: () => boolean, how: "nearest" | "center" = "nearest") {
  let ref: ViewRef | undefined;
  effect(() => {
    if (focused()) ref?.reveal({ horizontal: how, vertical: how });
  });
  return (r: ViewRef) => (ref = r);
}

export function Icon(props: { src: () => ImageAsset | string; size: number; color?: () => string }) {
  return (
    <Image
      src={props.src()}
      style={{ width: u(props.size), height: u(props.size), tintColor: props.color ? props.color() : colors.snow() }}
    />
  );
}

/** A rounded-rectangle button: white Play, grey secondary. */
export function Button(props: {
  label: () => string;
  icon?: () => ImageAsset;
  kind: "primary" | "secondary";
  focused: () => boolean;
  onPress: () => void;
  height?: number;
}) {
  const fg = () => (props.kind === "primary" ? colors.ink() : colors.snow());
  return (
    <View
      role="button"
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.9 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: u(12),
        height: u(props.height ?? 60),
        paddingHorizontal: u(28),
        borderRadius: radius(), borderCurve: "continuous",
        backgroundColor: props.kind === "primary" ? colors.snow() : colors.raise(),
        ...focusRing(props.focused()),
      }}
    >
      <If when={props.icon}>
        <Icon src={props.icon!} size={24} color={fg} />
      </If>
      <Text style={{ ...type.label(), fontWeight: 600, color: fg() }}>{props.label()}</Text>
    </View>
  );
}

/** A round icon button; its label is for screen readers (and tests). */
export function IconButton(props: {
  icon: () => ImageAsset;
  label: () => string;
  focused: () => boolean;
  selected?: () => boolean;
  onPress: () => void;
  size?: number;
  background?: () => string;
}) {
  const size = props.size ?? 62;
  return (
    <View
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={{
        width: u(size),
        height: u(size),
        borderRadius: 999, borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.selected?.() ? colors.control() : props.background ? props.background() : colors.card(),
        ...focusRing(props.focused()),
      }}
    >
      <Icon src={props.icon} size={size * 0.42} />
    </View>
  );
}

/** An outlined badge: 4K, 1080p, CC. */
export function Badge(props: { text: string; size?: number }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.ash(),
        borderRadius: u(4), borderCurve: "continuous",
        paddingHorizontal: u(9),
        paddingVertical: u(4),
      }}
    >
      <Text style={{ fontFamily: font, fontSize: u(props.size ?? 20), fontWeight: 500, color: colors.snow() }}>{props.text}</Text>
    </View>
  );
}

/** "★ 7.9": the one red mark next to a rating. */
export function Rating(props: { rating: string; size: number; color?: () => string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: u(6) }}>
      <Text style={{ fontFamily: font, fontSize: u(props.size), color: colors.red() }}>★</Text>
      <Text style={{ fontFamily: font, fontSize: u(props.size), fontWeight: 500, color: props.color ? props.color() : colors.snow() }}>
        {props.rating}
      </Text>
    </View>
  );
}

/** Under a card: a red star, then "7.9 · 1963 · Movie". */
export function CardMeta(props: { text: () => string; size?: number }) {
  return (
    <Text style={{ numberOfLines: 1, ...type.meta(), fontSize: u(props.size ?? 22), color: colors.ash() }}>
      <Text style={{ color: colors.red() }}>★ </Text>
      {props.text()}
    </Text>
  );
}

/** People sharing: four monochrome bars, then the count. */
export function SignalBars(props: { bars: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: u(3) }}>
      <Each of={[8, 13, 18, 23]} key="index">
        {(h, i) => (
          <View
            style={{
              width: u(5),
              height: u(h()),
              borderRadius: 1, borderCurve: "continuous",
              backgroundColor: i() < props.bars ? colors.snow() : colors.raise(),
            }}
          />
        )}
      </Each>
    </View>
  );
}

/** A still or a poster; without one, the title set in its own two colours. */
export function Picture(props: {
  item: () => Summary;
  src: () => string | null;
  style: ViewStyle;
  /** Fallback title size, TV pixels. */
  titleSize: number;
  position?: string;
}) {
  return (
    <View style={{ overflow: "hidden", backgroundColor: props.src() ? colors.card() : props.item().paper, ...props.style }}>
      <If
        when={props.src()}
        else={
          <View style={{ flex: 1, padding: u(18), justifyContent: "flex-end" }}>
            <Text style={{ numberOfLines: 3, ...type.logotype(props.titleSize), fontWeight: 300, color: props.item().ink }}>
              {titleText(props.item())}
            </Text>
          </View>
        }
      >
        <Image
          src={props.src()!}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, objectFit: "cover", objectPosition: props.position ?? "center" }}
        />
      </If>
    </View>
  );
}

/** A thin watched bar along the bottom of a thumbnail. */
export function WatchedBar(props: { progress: () => number }) {
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: u(5), backgroundColor: colors.raise() }}>
      <View style={{ height: "100%", width: `${Math.round(props.progress() * 100)}%`, backgroundColor: colors.snow() }} />
    </View>
  );
}

export function Logo() {
  return (
    <Text style={{ fontFamily: font, fontSize: u(40), fontWeight: 700, letterSpacing: -u(0.5), color: colors.red() }}>
      {t("app.name")}
    </Text>
  );
}

export const NAV: { id: Destination; icon: ImageAsset; pill: boolean }[] = [
  { id: "home", icon: homeIcon, pill: true },
  { id: "movies", icon: moviesIcon, pill: true },
  { id: "shows", icon: showsIcon, pill: true },
  { id: "search", icon: searchIcon, pill: false },
  { id: "settings", icon: settingsIcon, pill: false },
];

/** The floating nav: logo left; Home, Movies, Shows as pills (the current
 * one in a lighter pill), then round search and settings buttons. */
export function NavBar(props: { current: Destination; focused: () => number | null; onPick: (i: number) => void }) {
  const pills = NAV.filter((n) => n.pill);
  const icons = NAV.filter((n) => !n.pill);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: safe().x,
        paddingTop: u(50),
        zIndex: 3,
      }}
    >
      <Logo />
      <View style={{ flexDirection: "row", alignItems: "center", gap: u(10) }}>
        <View style={{ flexDirection: "row", gap: u(2), padding: u(5), borderRadius: radius() + u(5), borderCurve: "continuous", backgroundColor: colors.card() }}>
          <Each of={pills} key={(n) => n.id}>
            {(n, i) => (
              <View
                role="button"
                accessibilityLabel={t(`nav.${n().id}`)}
                onPress={() => props.onPick(i())}
                hoverStyle={{ backgroundColor: colors.raise() }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: u(10),
                  height: u(52),
                  paddingHorizontal: u(20),
                  borderRadius: radius(), borderCurve: "continuous",
                  backgroundColor: props.current === n().id ? colors.nav() : "transparent",
                  ...focusRing(props.focused() === i()),
                }}
              >
                <Icon src={() => n().icon} size={24} color={() => (props.current === n().id ? colors.snow() : colors.dim())} />
                <If when={density !== "compact"}>
                  <Text style={{ ...type.label(), color: props.current === n().id ? colors.snow() : colors.dim() }}>
                    {t(`nav.${n().id}`)}
                  </Text>
                </If>
              </View>
            )}
          </Each>
        </View>
        <Each of={icons} key={(n) => n.id}>
          {(n, i) => (
            <IconButton
              icon={() => n().icon}
              label={() => t(`nav.${n().id}`)}
              focused={() => props.focused() === pills.length + i()}
              selected={() => props.current === n().id}
              onPress={() => props.onPick(pills.length + i())}
            />
          )}
        </Each>
      </View>
    </View>
  );
}

/** A detail screen's top-left round back button. */
export function BackButton(props: { focused: () => boolean; onPress: () => void }) {
  return (
    <IconButton icon={() => backIcon} label={() => t("nav.back")} focused={props.focused} onPress={props.onPress} size={64} />
  );
}

/** Rating, votes, year, length and badges in one line. */
export function MetaLine(props: { item: () => Summary }) {
  const s = props.item;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: u(16) }}>
      <Rating rating={s().rating} size={26} />
      <Text style={{ ...type.label(), fontSize: u(26), fontWeight: 400, color: colors.ash(), marginLeft: -u(6) }}>{s().votes}</Text>
      <Text style={{ ...type.label(), fontSize: u(26), color: colors.snow() }}>{yearsText(s())}</Text>
      <Text style={{ ...type.label(), fontSize: u(26), color: colors.snow() }}>{lengthText(s())}</Text>
      <Each of={s().badges} key="index">
        {(b) => <Badge text={badgeText(b())} />}
      </Each>
    </View>
  );
}

/** The release Play uses: its name bold, then size, people sharing, start. */
export function ReleaseText(props: { item: () => Summary; withStart?: boolean; size?: number }) {
  return (
    <If when={props.item().release}>
      <Text style={{ ...type.meta(), fontSize: u(props.size ?? 22), color: colors.ash() }}>
        <Text style={{ fontWeight: 500, color: colors.snow() }}>{releaseLine(props.item().release!, props.withStart ?? true).name}</Text>
        {` · ${releaseLine(props.item().release!, props.withStart ?? true).rest}`}
      </Text>
    </If>
  );
}

/** The top of home and title screens: the still filling the top of the
 * screen and fading into the background, the logotype, meta, genres,
 * about and the actions bottom-left. */
export function Hero(props: {
  item: () => Summary;
  /** Height in TV pixels, and where the backdrop starts from the left. */
  height: number;
  backdropLeft?: number;
  titleSize: number;
  /** Top padding of the text block (room for the nav or the back button). */
  top: number;
  children: JSX.Element;
}) {
  const s = props.item;
  return (
    <View style={{ minHeight: u(props.height) }}>
      <View style={{ position: "absolute", top: 0, right: 0, left: u(props.backdropLeft ?? 0), height: u(props.height) }}>
        <If
          when={s().still}
          else={<View style={{ flex: 1, backgroundColor: s().paper, opacity: 0.55 }} />}
        >
          <Image src={s().still!} style={{ flex: 1, objectFit: "cover", objectPosition: "center 30%" }} />
        </If>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: heroFade() }} />
        <If when={(props.backdropLeft ?? 0) > 0}>
          <View
            style={{
              position: "absolute", top: 0, left: 0, bottom: 0, width: "40%",
              backgroundImage: `linear-gradient(90deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
            }}
          />
        </If>
      </View>
      <View style={{ paddingHorizontal: safe().x, paddingTop: u(props.top), gap: u(14), maxWidth: u(1300) }}>
        <Text style={{ numberOfLines: 2, ...type.logotype(props.titleSize), color: colors.snow(), marginBottom: u(10) }}>
          {titleText(s())}
        </Text>
        <MetaLine item={s} />
        <Text style={{ ...type.meta(), fontSize: u(24), color: colors.ash() }}>{genresText(s())}</Text>
        <Text style={{ numberOfLines: 2, ...type.body(), color: colors.soft(), maxWidth: u(980) }}>{aboutText(s())}</Text>
        {props.children}
      </View>
    </View>
  );
}
