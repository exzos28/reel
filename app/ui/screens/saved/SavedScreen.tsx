// Saved, a nav destination (a round button after Settings; design/offline-downloads.md and
// design/concept/mac-saved.html): what is saved on this device and plays without the
// internet. Over the rows, the space saved and free and the folder; then what is saving
// (Pause / Resume, Remove), what is ready to watch, and what could not be saved. A row opens
// its title, whose Play plays the saved file. Up and Down move through the rows (Up from the
// first: the nav), Left and Right to a row's buttons; OK acts.
import { keymap, signal, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { useRootBack } from "../../focus/rootBack";
import { caps } from "../../platform";
import { NAV } from "../../layout/navItems";
import { showNav } from "../../layout/navState";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { goFromNav, openTitle } from "../../nav";
import { metaText, sectionTitle } from "../../kit/text";
import { Fmt } from "../../native";
import { openSavedFolder, pauseSaved, removeSaved, savedList, titleOf, watchSaved, type SavedItem } from "../../library";
import { Button } from "../../kit/Button";
import { row } from "../../kit/shape";
import { alpha, colors, cs, safe, u } from "../../theme";
import { rounded } from "../../kit/shape";
import { SavedRow } from "./SavedRow";

const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(24), gap: u(12) });
const sectionStyle = (): ViewStyle => ({ marginTop: u(28), marginBottom: u(4) });
const spaceTrack = (): ViewStyle => ({ height: cs(4), ...rounded(999), backgroundColor: colors.raise(), overflow: "hidden", flexDirection: "row", marginTop: u(8), maxWidth: cs(520) });
const SAVED_AT = NAV.findIndex((n) => n.id === "saved");

/** "21.6 GB saved · 212 GB free in ~/Movies/reel". */
function spaceLine(saved: number, free: number | null, folder: string | null) {
  const parts = [t("saved.space.saved", { size: Fmt.size(saved) })];
  if (free != null) parts.push(t("saved.space.free", { size: Fmt.size(free) }));
  if (folder) parts.push(folder);
  return parts.join(" · ");
}

export function SavedScreen() {
  watchSaved();
  const list = () => savedList();
  /** Every row the focus walks, in order: saving, ready, failed. */
  const rows = (): SavedItem[] => [...list().saving, ...list().ready, ...list().failed];
  const focus = signal(0);
  /** The part of the focused row: 0 the row, 1 pause / resume, 2 remove. */
  const part = signal(0);
  const onNav = signal(false);
  const navAt = signal(SAVED_AT);
  const toNav = () => {
    navAt.set(SAVED_AT);
    onNav.set(true);
  };
  const at = () => (onNav() ? -1 : clamp(focus(), rows().length - 1));
  const hasPause = (i: SavedItem | undefined) => i?.state === "saving" || i?.state === "paused";
  const open = (i: SavedItem) => openTitle(titleOf(i.key));
  const act = (i: SavedItem, p: number) => {
    if (p === 0) open(i);
    else if (p === 1) pauseSaved(i.id, i.state === "saving");
    else removeSaved(i.id);
  };

  keymap.bind(
    byKeys({
      up: () => (onNav() ? undefined : at() <= 0 ? toNav() : (focus.set(at() - 1), part.set(0))),
      down: () => (onNav() ? onNav.set(false) : (focus.set(clamp(at() + 1, rows().length - 1)), part.set(0))),
      left: () => (onNav() ? navAt.set(clamp(navAt() - 1, NAV.length - 1)) : part.set(part() === 2 && !hasPause(rows()[at()]) ? 0 : Math.max(part() - 1, 0))),
      right: () =>
        onNav() ? navAt.set(clamp(navAt() + 1, NAV.length - 1)) : part.set(part() === 0 && !hasPause(rows()[at()]) ? 2 : Math.min(part() + 1, 2)),
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (onNav()) return goFromNav(NAV[navAt()].id);
      const i = rows()[at()];
      if (i) act(i, part());
    },
  });

  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "saved" });
  showNav(() => (onNav() ? navAt() : null));
  useRootBack({ ctl: page, onNav, toNav });

  const rowsOf = (items: () => SavedItem[], offset: () => number) => (
    <Each of={items()} key={(i) => String(i.id)}>
      {(i, n) => (
        <SavedRow
          item={i}
          focusedPart={() => (at() === offset() + n() ? part() : null)}
          viewRef={page.follow(() => at() === offset() + n())}
          onOpen={() => open(i())}
          onPause={() => pauseSaved(i().id, i().state === "saving")}
          onRemove={() => removeSaved(i().id)}
        />
      )}
    </Each>
  );

  const used = () => list().space.saved;
  const free = () => list().space.free;
  const share = () => (free() != null && used() + free()! > 0 ? used() / (used() + free()!) : 0);
  return (
    <PageFrame ctl={page} kind={caps.touch ? "deep" : "root"} title={() => t("saved.title")}>
      <View style={pageStyle()}>
        <View style={row(u(20))}>
          <Text style={{ ...metaText(), flexShrink: 1 }}>{spaceLine(used(), free(), list().space.folder)}</Text>
          {/* The folder in Finder / File Explorer: a desktop has a file manager. */}
          <If when={!caps.touch && !caps.remote}>
            <Button kind="secondary" height={44} label={() => t("saved.open_folder")} focused={() => false} onPress={openSavedFolder} />
          </If>
        </View>
        <View style={spaceTrack()}>
          <View style={{ width: `${Math.max(1, Math.round(share() * 100))}%`, height: "100%", backgroundColor: colors.snow() }} />
        </View>
        <If when={rows().length === 0}>
          <Text style={{ ...metaText(colors.soft()), marginTop: u(32) }}>{t("saved.empty")}</Text>
        </If>
        <If when={list().saving.length > 0}>
          <View style={sectionStyle()}>
            <Text style={sectionTitle()}>{t("saved.saving")}</Text>
            <Text style={metaText()}>{t("saved.while_open")}</Text>
          </View>
          {rowsOf(() => list().saving, () => 0)}
        </If>
        <If when={list().ready.length > 0}>
          <View style={sectionStyle()}>
            <Text style={sectionTitle()}>{t("saved.ready")}</Text>
          </View>
          {rowsOf(() => list().ready, () => list().saving.length)}
        </If>
        <If when={list().failed.length > 0}>
          <View style={sectionStyle()}>
            <Text style={{ ...sectionTitle(), color: alpha(colors.snow(), 0.8) }}>{t("saved.not_saved")}</Text>
          </View>
          {rowsOf(() => list().failed, () => list().saving.length + list().ready.length)}
        </If>
      </View>
    </PageFrame>
  );
}
