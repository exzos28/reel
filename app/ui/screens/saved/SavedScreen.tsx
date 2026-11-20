// Saved, a nav destination (a round button after Settings; design/offline-downloads.md and
// design/concept/mac-saved.html): what is saved on this device and plays without the
// internet. Over the rows, the space saved and free, the folder and Open folder; then what is
// saving, what is ready to watch, and what could not be saved, each grouped by title: a film is
// one row, a show one row whose episodes open under it. On a tablet what is ready to watch is a
// grid of cards (SavedCard): a film plays, a show opens its page; Remove is in a card's menu. A saved film or episode plays when
// pressed (its Play button too); one still saving has Pause / Resume. Remove asks first. Up
// and Down move through the rows (Up from the first: the nav), Left and Right to a row's
// buttons; OK acts. With nothing saved, no space: a line and Browse films, which goes Home.
import { computed, keymap, signal, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { useRootBack } from "../../focus/rootBack";
import { caps } from "../../platform";
import { ConfirmDialog, type Confirm } from "../../layout/ConfirmDialog";
import { NAV } from "../../layout/navItems";
import { showNav } from "../../layout/navState";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { go, goFromNav, openTitle } from "../../nav";
import { episodeCode, title as catalogTitle } from "../../catalog";
import { play } from "../../playback";
import { bodyText, metaText, sectionTitle } from "../../kit/text";
import { Fmt } from "../../native";
import { openSavedFolder, pauseSaved, removeSaved, savedList, savingOverall, titleOf, watchSaved, type SavedGroup, type SavedItem } from "../../library";
import { Button } from "../../kit/Button";
import { rounded, row } from "../../kit/shape";
import { alpha, colors, cs, safe, u } from "../../theme";
import { SavedGroupRow } from "./SavedGroupRow";
import { SavedRow } from "./SavedRow";
import { SavedCard } from "./SavedCard";
import { cellWidth, GRID_GAP, GRID_ROW_GAP, gridRows } from "../../layout/Grid";
import { cardColumns, savedCards } from "../../layout/wide";

const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(24), gap: u(12) });
const sectionStyle = (): ViewStyle => ({ marginTop: u(28), marginBottom: u(4) });
const spaceTrack = (): ViewStyle => ({ height: cs(4), ...rounded(999), backgroundColor: colors.raise(), overflow: "hidden", flexDirection: "row", marginTop: u(8), maxWidth: cs(520) });
const emptyStyle = (): ViewStyle => ({ marginTop: u(16), gap: u(24), alignItems: "flex-start" });
const SAVED_AT = NAV.findIndex((n) => n.id === "saved");

type Section = "saving" | "ready" | "failed";
const SECTIONS: Section[] = ["saving", "ready", "failed"];

/** A row the focus walks: a show's row, or a film or an episode; on a tablet a ready film's or
 * show's card. */
type Entry =
  | { kind: "group"; section: Section; group: SavedGroup; key: string }
  | { kind: "card"; section: Section; group: SavedGroup; key: string }
  | { kind: "item"; section: Section; item: SavedItem; nested: boolean; key: string };

/** "21.6 GB saved · 212 GB free · ~/Movies/reel" (the folder only where it can be opened: a
 * computer; a phone's is the app's own, a path that says nothing). */
function spaceLine(saved: number, free: number | null, folder: string | null) {
  const parts = [t("saved.space.saved", { size: Fmt.size(saved) })];
  if (free != null) parts.push(t("saved.space.free", { size: Fmt.size(free) }));
  if (folder) parts.push(folder);
  return parts.join(" · ");
}

/** An item's name in the question before it is removed: "The Mentalist S1:E1" or the film. */
const itemName = (i: SavedItem) => (i.season != null && i.number != null ? `${i.title} ${episodeCode(i.season, i.number)}` : i.title);

/** Shows opened (or, while they save, closed) by the viewer: "<section>:<title id>". Kept while
 * the app runs: the player over the page makes the page again after it closes. */
const toggled = signal<Set<string>>(new Set());

export function SavedScreen() {
  watchSaved();
  /** Asked once per second (and per change), not once per place that reads it. */
  const list = computed(() => savedList());
  /** A show's episodes show under it: while saving unless closed, when ready once opened. */
  const isOpen = (section: Section, g: SavedGroup) => (section === "saving") !== toggled().has(`${section}:${g.id}`);
  const toggle = (section: Section, g: SavedGroup) => {
    const next = new Set(toggled());
    const k = `${section}:${g.id}`;
    next.has(k) ? next.delete(k) : next.add(k);
    toggled.set(next);
  };
  const entriesOf = (section: Section): Entry[] =>
    section === "ready" && savedCards()
      ? list().ready.map((g): Entry => ({ kind: "card", section, group: g, key: `c:${g.id}` }))
      : list()[section].flatMap((g): Entry[] =>
      g.show
        ? [
            { kind: "group", section, group: g, key: `g:${section}:${g.id}` },
            ...(isOpen(section, g) ? g.items.map((i): Entry => ({ kind: "item", section, item: i, nested: true, key: `i:${i.id}` })) : []),
          ]
        : g.items.map((i): Entry => ({ kind: "item", section, item: i, nested: false, key: `i:${i.id}` })),
    );
  /** Every row the focus walks, in order. */
  const rows = computed((): Entry[] => SECTIONS.flatMap(entriesOf));
  const offset = (section: Section) => SECTIONS.slice(0, SECTIONS.indexOf(section)).reduce((n, s) => n + entriesOf(s).length, 0);

  const focus = signal(0);
  /** The part of the focused row: 0 the row, 1 play or pause / resume, 2 remove. */
  const part = signal(0);
  const onNav = signal(false);
  const navAt = signal(SAVED_AT);
  const toNav = () => {
    navAt.set(SAVED_AT);
    onNav.set(true);
  };
  const at = () => (onNav() ? -1 : clamp(focus(), rows().length - 1));
  /** Nothing saved, saving or being found: the screen invites to find a film. */
  const empty = () => rows().length === 0 && !savingOverall().saving;
  /** Something is on the device or coming to it: the space it takes shows. */
  const anySaved = () => list().saving.length > 0 || list().ready.length > 0;
  const browse = () => go("home");

  /** The question before files go. */
  const ask = signal<Confirm | null>(null);
  const askRemove = (ids: number[], name: string, size: number) =>
    ask.set({
      title: t("saved.remove_title", { name }),
      about: t("saved.remove_about", { size: Fmt.size(size) }),
      action: t("saved.remove"),
      onConfirm: () => ids.forEach(removeSaved),
    });
  // What is on the device now (an unfinished one holds only what came), not the release's size.
  const removeItem = (i: SavedItem) => askRemove([i.id], itemName(i), i.have);
  const removeGroup = (g: SavedGroup) => askRemove(g.items.map((i) => i.id), g.title, g.have);

  const open = (i: SavedItem) => openTitle(titleOf(i.key));
  /** Plays the saved file (the core opens it, no network), titled from the catalog's cache;
   * while that is not known, its page. */
  const playItem = (i: SavedItem) => {
    const tt = catalogTitle(titleOf(i.key));
    if (!tt || tt.notice) return open(i);
    play({ id: i.key, season: i.season ?? undefined, episode: i.number ?? undefined, title: tt });
  };
  /** A show's episodes that can pause or go on (their torrent is in). */
  const pausable = (g: SavedGroup) => g.items.filter((i) => i.state === "saving" || i.state === "paused");
  const allPaused = (g: SavedGroup) => pausable(g).length > 0 && pausable(g).every((i) => i.state === "paused");
  /** Pauses them all, or goes on with them all when all are paused. */
  const pauseGroup = (g: SavedGroup) => {
    const resume = allPaused(g);
    for (const i of pausable(g)) if ((i.state === "paused") === resume) pauseSaved(i.id, !resume);
  };
  /** Its middle button: Play once saved, Pause / Resume while saving (a show's, for them all). */
  const hasMiddle = (e: Entry | undefined) =>
    e?.kind === "item" ? ["saving", "paused", "saved"].includes(e.item.state) : e?.kind === "group" && pausable(e.group).length > 0;
  const act = (e: Entry, p: number) => {
    if (e.kind === "card") {
      const first = e.group.items[0];
      if (p === 2) return e.group.show ? removeGroup(e.group) : removeItem(first);
      return e.group.show ? open(first) : playItem(first);
    }
    if (e.kind === "group") return p === 2 ? removeGroup(e.group) : p === 1 ? pauseGroup(e.group) : toggle(e.section, e.group);
    const i = e.item;
    if (p === 2) return removeItem(i);
    if (i.state === "saved") return playItem(i);
    if (p === 1) return pauseSaved(i.id, i.state === "saving");
    open(i);
  };

  keymap.bind(
    byKeys({
      up: () => (onNav() ? undefined : at() <= 0 ? toNav() : (focus.set(at() - 1), part.set(0))),
      down: () => (onNav() ? onNav.set(false) : (focus.set(clamp(at() + 1, rows().length - 1)), part.set(0))),
      left: () => (onNav() ? navAt.set(clamp(navAt() - 1, NAV.length - 1)) : part.set(part() === 2 && !hasMiddle(rows()[at()]) ? 0 : Math.max(part() - 1, 0))),
      // A card has no buttons to move to (Remove is in its menu).
      right: () =>
        onNav() ? navAt.set(clamp(navAt() + 1, NAV.length - 1)) : rows()[at()]?.kind === "card" ? undefined : part.set(part() === 0 && !hasMiddle(rows()[at()]) ? 2 : Math.min(part() + 1, 2)),
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (onNav()) return goFromNav(NAV[navAt()].id);
      if (empty()) return browse();
      const e = rows()[at()];
      if (e) act(e, part());
    },
  });

  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "saved" });
  showNav(() => (onNav() ? navAt() : null));
  useRootBack({ ctl: page, onNav, toNav });

  const sectionRows = (section: Section) => (
    <Each of={entriesOf(section)} key={(e) => e.key}>
      {(e, n) => {
        const here = () => at() === offset(section) + n();
        return (
          <If
            when={e().kind === "group"}
            else={
              <SavedRow
                item={() => (e() as Extract<Entry, { kind: "item" }>).item}
                nested={(e() as Extract<Entry, { kind: "item" }>).nested}
                focusedPart={() => (here() ? part() : null)}
                viewRef={page.follow(here)}
                onOpen={() => act(e(), 0)}
                onPlay={() => act(e(), 1)}
                onPause={() => act(e(), 1)}
                onRemove={() => act(e(), 2)}
              />
            }
          >
            <SavedGroupRow
              group={() => (e() as Extract<Entry, { kind: "group" }>).group}
              open={() => isOpen(section, (e() as Extract<Entry, { kind: "group" }>).group)}
              saving={section === "saving"}
              focusedPart={() => (here() ? part() : null)}
              viewRef={page.follow(here)}
              onToggle={() => act(e(), 0)}
              onPause={section === "saving" && pausable((e() as Extract<Entry, { kind: "group" }>).group).length > 0 ? () => act(e(), 1) : undefined}
              paused={() => allPaused((e() as Extract<Entry, { kind: "group" }>).group)}
              onRemove={() => act(e(), 2)}
            />
          </If>
        );
      }}
    </Each>
  );

  /** A tablet's ready films and shows: cards, `cardColumns()` across. */
  const cardRows = () => gridRows(entriesOf("ready"), cardColumns());
  const readyCards = () => (
    <View style={{ gap: u(GRID_ROW_GAP) }}>
      <Each of={cardRows()} key={(r) => r.at}>
        {(r) => (
          <View style={{ flexDirection: "row", gap: u(GRID_GAP) }}>
            <Each of={r().items} key={(e) => e.key}>
              {(e, c) => {
                const here = () => at() === offset("ready") + r().at + c();
                return (
                  <SavedCard
                    group={() => (e() as Extract<Entry, { kind: "card" }>).group}
                    width={() => cellWidth(cardColumns(), GRID_GAP)}
                    focused={here}
                    viewRef={page.follow(here)}
                    onPress={() => act(e(), 0)}
                    onRemove={() => act(e(), 2)}
                  />
                );
              }}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );

  const used = () => list().space.saved;
  const free = () => list().space.free;
  const share = () => (free() != null && used() + free()! > 0 ? used() / (used() + free()!) : 0);
  return (
    <View style={{ flex: 1 }}>
      <PageFrame ctl={page} kind="root" title={() => t("saved.title")}>
        <View style={pageStyle()}>
          <If when={anySaved()}>
            <View style={row(u(20))}>
              <Text style={{ ...metaText(), flexShrink: 1 }}>{spaceLine(used(), free(), caps.touch ? null : list().space.folder)}</Text>
              {/* The folder in Finder / File Explorer: a desktop has a file manager. */}
              <If when={!caps.touch && !caps.remote}>
                <Button kind="secondary" height={44} label={() => t("saved.open_folder")} focused={() => false} onPress={openSavedFolder} />
              </If>
            </View>
            <View style={spaceTrack()}>
              <View style={{ width: `${Math.max(1, Math.round(share() * 100))}%`, height: "100%", backgroundColor: colors.snow() }} />
            </View>
          </If>
          <If when={empty()}>
            <View style={emptyStyle()}>
              <Text style={bodyText(colors.soft())}>{t("saved.empty")}</Text>
              <Button kind="primary" height={48} label={() => t("saved.browse")} focused={() => !onNav()} onPress={browse} />
            </View>
          </If>
          <If when={list().saving.length > 0}>
            <View style={sectionStyle()}>
              <Text style={sectionTitle()}>{t("saved.saving")}</Text>
              <Text style={metaText()}>{t("saved.while_open")}</Text>
            </View>
            {sectionRows("saving")}
          </If>
          <If when={list().ready.length > 0}>
            <View style={sectionStyle()}>
              <Text style={sectionTitle()}>{t("saved.ready")}</Text>
            </View>
            {savedCards() ? readyCards() : sectionRows("ready")}
          </If>
          <If when={list().failed.length > 0}>
            <View style={sectionStyle()}>
              <Text style={{ ...sectionTitle(), color: alpha(colors.snow(), 0.8) }}>{t("saved.not_saved")}</Text>
            </View>
            {sectionRows("failed")}
          </If>
        </View>
      </PageFrame>
      <ConfirmDialog ask={ask} onClose={() => ask.set(null)} />
    </View>
  );
}
