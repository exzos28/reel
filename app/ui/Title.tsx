// A film or a show. The hero with Play and Add to list, the release Play
// uses; then for a film its releases (fastest to start first), for a show
// the season tabs and the episodes. Remote: the focus starts on Play; Up
// from the actions reaches the back button; on the season tabs Left and
// Right switch the season; OK on a release makes it the one Play uses, on
// an episode plays it. Back goes one level up.
import { computed, Image, keymap, signal, Text, View, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import {
  chooseRelease, dateText, episodeText, episodes, noteText, playLabel, title as titleOf, toggleList, tracksText,
  runtime, type Episode, type Release, type Title as TitleData,
} from "./catalog";
import { BackButton, Badge, Button, Hero, Icon, ReleaseText, SignalBars, WatchedBar } from "./components";
import { back } from "./nav";
import { play } from "./playback";
import { byKeys, Scroller, scroller } from "./Scroller";

/** A block's ref that a scroll view follows while `when` holds (`ScrollCtl.follow`). */
type Follow = (when: () => boolean) => (r: ViewRef) => void;
import { colors, density, focusRing, font, radius, ringRoom, safe, selectedFill, type, u } from "./theme";
import playIcon from "./icons/play.svg";
import plusIcon from "./icons/plus.svg";
import checkIcon from "./icons/check.svg";

type Zone = "back" | "actions" | "tabs" | "list";

// One title screen's focus, kept while the player or a deeper screen shows;
// another title starts over.
let shownId = "";
const zone = signal<Zone>("actions");
const action = signal(0);
const season = signal(1);
const item = signal(0);

export function Title(props: { id: string }) {
  const data = computed(() => titleOf(props.id) as TitleData);
  const isShow = () => data().kind === "show";
  if (shownId !== props.id) {
    shownId = props.id;
    zone.set("actions");
    action.set(0);
    season.set(data().season ?? 1);
    item.set(0);
  }
  const eps = computed<Episode[]>(() => (isShow() ? episodes(props.id, season()) : []));
  const seasons = () => data().seasonList ?? [];
  /** Rows under the tabs: episodes of a show, releases of a film. */
  const listLength = () => (isShow() ? eps().length : data().releases.length);
  const playEpisode = (e: Episode) => play({ id: e.id, season: e.season, episode: e.number, title: data() });
  const actions = [() => play({ ...data().play, title: data() }), () => toggleList(props.id)];
  /** Where the focus lands in a season's episodes: where the viewer is, else the first. */
  const firstItem = () => {
    const r = data().resume;
    return r && r.season === season() ? r.episode - 1 : 0;
  };

  /** The page puts the focused row (or the season tabs) in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });

  keymap.bind(
    byKeys({
      left: () => {
        if (zone() === "actions") action.set(Math.max(action() - 1, 0));
        else if (zone() === "tabs") season.set(Math.max(season() - 1, 1));
      },
      right: () => {
        if (zone() === "actions") action.set(Math.min(action() + 1, actions.length - 1));
        else if (zone() === "tabs") season.set(Math.min(season() + 1, seasons().length));
      },
      up: () => {
        if (zone() === "actions") zone.set("back");
        else if (zone() === "tabs") zone.set("actions");
        else if (zone() === "list") {
          if (item() > 0) item.set(item() - 1);
          else zone.set(isShow() ? "tabs" : "actions");
        }
      },
      down: () => {
        if (zone() === "back") zone.set("actions");
        else if (zone() === "actions") {
          if (isShow()) zone.set("tabs");
          else if (listLength() > 0) {
            zone.set("list");
            item.set(0);
          }
        } else if (zone() === "tabs") {
          if (listLength() > 0) {
            zone.set("list");
            item.set(firstItem());
          }
        } else if (zone() === "list") item.set(Math.min(item() + 1, listLength() - 1));
      },
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (zone() === "back") back();
      else if (zone() === "actions") actions[action()]();
      else if (zone() === "list") {
        if (isShow()) playEpisode(eps()[item()]);
        else chooseRelease(props.id, data().releases[item()].index);
      }
    },
    escape: back,
  });

  return (
    <Scroller ctl={page} style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View style={{ paddingBottom: safe().y + u(40) }}>
        <View style={{ position: "absolute", top: safe().y, left: safe().x, zIndex: 3 }}>
          <BackButton focused={() => zone() === "back"} onPress={back} />
        </View>
        <View ref={page.follow(() => zone() === "back" || zone() === "actions", "start")}>
        <Hero item={data} height={isShow() ? 640 : 700} backdropLeft={isShow() ? 520 : 560} titleSize={isShow() ? 76 : 88} top={isShow() ? 150 : 176}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: u(16), marginTop: u(12) }}>
            <Button
              kind="primary"
              icon={() => playIcon}
              label={() => playLabel(data())}
              focused={() => zone() === "actions" && action() === 0}
              onPress={actions[0]}
            />
            <Button
              kind="secondary"
              icon={() => (data().inList ? checkIcon : plusIcon)}
              label={() => (data().inList ? t("title.in_list") : t("title.add_to_list"))}
              focused={() => zone() === "actions" && action() === 1}
              onPress={actions[1]}
            />
            <View style={{ marginLeft: u(12) }}>
              <ReleaseText item={data} withStart={false} />
            </View>
          </View>
        </Hero>
        </View>
        <If
          when={isShow()}
          else={
            <Releases
              releases={() => data().releases}
              focused={(i) => zone() === "list" && item() === i}
              follow={page.follow}
              onPress={(i) => {
                zone.set("list");
                item.set(i);
                chooseRelease(props.id, data().releases[i].index);
              }}
            />
          }
        >
          <Seasons
            seasons={seasons}
            season={season}
            focused={() => zone() === "tabs"}
            follow={page.follow}
            onPick={(n) => {
              zone.set("tabs");
              season.set(n);
            }}
            sub={() => {
              const s = seasons()[season() - 1];
              return s ? `${t("series.episodes", { count: s.episodes })} · ${t(`shows.${props.id}.seasons.s${s.number}`)}` : "";
            }}
          />
          <View style={{ paddingHorizontal: safe().x, gap: u(12), marginTop: u(26) }}>
            <If when={eps().length > 0} else={<Text style={{ ...type.body(), color: colors.ash() }}>{t("series.no_episodes")}</Text>}>
              <Each of={eps()} key={(e) => e.id}>
                {(e, i) => (
                  <EpisodeRow
                    episode={e}
                    focused={() => zone() === "list" && item() === i()}
                    follow={page.follow}
                    onPress={() => {
                      zone.set("list");
                      item.set(i());
                      playEpisode(e());
                    }}
                  />
                )}
              </Each>
            </If>
          </View>
        </If>
      </View>
    </Scroller>
  );
}

function Releases(props: { releases: () => Release[]; focused: (i: number) => boolean; follow: Follow; onPress: (i: number) => void }) {
  /** Columns on a TV and a Mac; a phone keeps what decides the choice. */
  const wide = density !== "compact";
  return (
    <View style={{ paddingHorizontal: safe().x, marginTop: u(40) }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: u(18) }}>
        <Text style={{ ...type.section(), color: colors.snow() }}>{t("releases.title")}</Text>
        <Text style={{ ...type.meta(), color: colors.ash() }}>{t("releases.found", { count: props.releases().length })}</Text>
      </View>
      <View style={{ gap: u(12), marginTop: u(20) }}>
        <Each of={props.releases()} key={(r) => r.index}>
          {(r, i) => (
            <View
              ref={props.follow(() => props.focused(i()))}
              role="button"
              accessibilityLabel={`${r().quality} ${r().source}`}
              accessibilityState={{ selected: r().selected }}
              onPress={() => props.onPress(i())}
              hoverStyle={{ backgroundColor: colors.raise() }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: wide ? u(24) : u(14),
                minHeight: u(76),
                paddingHorizontal: u(28),
                paddingVertical: u(12),
                borderRadius: radius(), borderCurve: "continuous",
                backgroundColor: r().selected ? colors.raise() : colors.card(),
                ...focusRing(props.focused(i()), "row"),
              }}
            >
              <View style={{ width: wide ? u(110) : undefined, alignItems: "flex-start" }}>
                <Badge text={r().quality} size={19} />
              </View>
              <Text style={{ numberOfLines: 1, flex: 1, minWidth: u(120), fontFamily: font, fontSize: u(23), fontWeight: 600, color: colors.snow() }}>
                {r().source}
                <Text style={{ fontWeight: 400, fontSize: u(22), color: colors.ash() }}>{r().group ? `   ${r().group}` : ""}</Text>
              </Text>
              <If when={wide}>
                <Text style={{ width: u(140), fontFamily: font, fontSize: u(23), color: colors.ash() }}>{r().size}</Text>
                <Text style={{ numberOfLines: 1, width: u(380), fontFamily: font, fontSize: u(23), color: colors.ash() }}>{tracksText(r())}</Text>
              </If>
              <View style={{ width: wide ? u(250) : undefined, flexDirection: "row", alignItems: "center", gap: u(12) }}>
                <SignalBars bars={r().bars} />
                <Text style={{ fontFamily: font, fontSize: u(23), color: colors.ash() }}>{t("release.sharing_short", { count: r().peers })}</Text>
              </View>
              <View style={{ width: wide ? u(240) : undefined, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: u(10) }}>
                <If when={r().selected}>
                  <Icon src={() => checkIcon} size={22} />
                </If>
                <Text style={{ fontFamily: font, fontSize: u(23), color: r().selected ? colors.snow() : colors.ash() }}>{noteText(r())}</Text>
              </View>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}

function Seasons(props: {
  seasons: () => { number: number; year: number; episodes: number }[];
  season: () => number;
  focused: () => boolean;
  follow: Follow;
  onPick: (n: number) => void;
  sub: () => string;
}) {
  /** The tabs put the focused season at the left edge of their inset. */
  const tabs = scroller({ horizontal: true, anchor: () => ringRoom() });
  return (
    <View ref={props.follow(props.focused)} style={{ paddingHorizontal: safe().x - u(12) - ringRoom(), marginTop: u(36) - ringRoom() }}>
      <Scroller ctl={tabs}>
        <View style={{ flexDirection: "row", gap: u(6), paddingHorizontal: ringRoom(), paddingVertical: ringRoom() }}>
          <Each of={props.seasons()} key={(s) => s.number}>
            {(s) => (
              <View
                ref={tabs.follow(() => props.focused() && props.season() === s().number)}
                role="tab"
                accessibilityLabel={t("series.season", { number: s().number })}
                accessibilityState={{ selected: props.season() === s().number }}
                onPress={() => props.onPick(s().number)}
                hoverStyle={{ backgroundColor: colors.card() }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: u(10),
                  height: u(52),
                  paddingHorizontal: u(22),
                  borderRadius: radius(), borderCurve: "continuous",
                  backgroundColor: selectedFill(props.season() === s().number),
                  ...focusRing(props.focused() && props.season() === s().number),
                }}
              >
                <Text style={{ ...type.label(), fontWeight: 600, color: props.season() === s().number ? colors.snow() : colors.ash() }}>
                  {t("series.season", { number: s().number })}
                </Text>
                <Text style={{ ...type.small(), color: colors.ash() }}>{String(s().year)}</Text>
              </View>
            )}
          </Each>
        </View>
      </Scroller>
      <Text style={{ ...type.meta(), color: colors.ash(), marginLeft: u(32), marginTop: u(4) }}>{props.sub()}</Text>
    </View>
  );
}

function EpisodeRow(props: { episode: () => Episode; focused: () => boolean; follow: Follow; onPress: () => void }) {
  const e = props.episode;
  const meta = () => {
    const parts = [runtime(e().minutes), dateText(e().date)];
    if (e().left != null) parts.push(t("card.left", { time: runtime(e().left!) }));
    return parts.join(" · ");
  };
  return (
    <View
      ref={props.follow(props.focused)}
      role="button"
      accessibilityLabel={episodeText(e().show, e().season, e().number, "title")}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: u(26),
        minHeight: u(118),
        paddingLeft: u(18),
        paddingRight: u(26),
        paddingVertical: u(7),
        borderRadius: radius(), borderCurve: "continuous",
        backgroundColor: colors.card(),
        ...focusRing(props.focused(), "row"),
      }}
    >
      <Text style={{ width: u(74), textAlign: "center", fontFamily: font, fontSize: u(44), fontWeight: 300, color: e().watched ? colors.ash() : colors.faint() }}>
        {String(e().number)}
      </Text>
      <View style={{ width: u(185), height: u(104), borderRadius: u(8), borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.raise() }}>
        <If when={e().thumb}>
          <Image src={e().thumb!} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, objectFit: "cover", objectPosition: "center 30%" }} />
        </If>
        <View style={{ position: "absolute", left: u(8), bottom: u(10), flexDirection: "row", gap: u(5), paddingHorizontal: u(7), paddingVertical: u(3), borderRadius: u(5), borderCurve: "continuous", backgroundColor: colors.ink() }}>
          <Text style={{ fontFamily: font, fontSize: u(17), color: colors.red() }}>★</Text>
          <Text style={{ fontFamily: font, fontSize: u(17), fontWeight: 600, color: colors.snow() }}>{e().rating}</Text>
        </View>
        <If when={e().progress > 0}>
          <WatchedBar progress={() => e().progress} />
        </If>
      </View>
      <View style={{ flex: 1, gap: u(4) }}>
        <Text style={{ numberOfLines: 1, fontFamily: font, fontSize: u(26), fontWeight: 600, color: e().watched ? colors.ash() : colors.snow() }}>
          {episodeText(e().show, e().season, e().number, "title")}
        </Text>
        <Text style={{ fontFamily: font, fontSize: u(21), color: colors.ash() }}>{meta()}</Text>
        <Text style={{ numberOfLines: 1, fontFamily: font, fontSize: u(22), color: colors.quiet(), marginTop: u(2) }}>
          {episodeText(e().show, e().season, e().number, "about")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: u(8) }}>
        <If when={e().watched}>
          <Icon src={() => checkIcon} size={20} color={colors.ash} />
        </If>
        <Text style={{ fontFamily: font, fontSize: u(21), color: colors.ash() }}>
          {e().watched ? t("series.watched") : t("series.plays_now", { quality: e().quality ?? "" })}
        </Text>
      </View>
    </View>
  );
}
