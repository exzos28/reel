// The Save drawer of a show (design/offline-downloads.md, design/concept/mac-series-save.html):
// the seasons as tabs (how many of each are saved), "Whole season", then the episodes with
// checkboxes and sizes, and Save at the bottom counting only what is new. What is saved or
// being saved is checked and locked with its state: the drawer only adds (removing is on the
// Saved screen). Up and Down walk the rows and the Save button; Left and Right switch the
// season; OK ticks a row or saves.
import { Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { rounded, row } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { Drawer } from "../../layout/Drawer";
import { scroller, Scroller } from "../../layout/Scroller";
import { Fmt } from "../../native";
import type { PlanEpisode, SeasonPlan } from "../../library";
import { alpha, colors, cs, targetSlop, u } from "../../theme";
import checkIcon from "../../icons/check.svg";
import { SaveMark } from "../../kit/SaveMark";
import { Pressable } from "../../kit/Pressable";

const tabStyle = (selected: boolean): ViewStyle => ({ paddingHorizontal: cs(14), paddingVertical: cs(8), ...rounded(u(8)), backgroundColor: selected ? colors.raise() : "transparent" });
const rowBox = (focused: boolean): ViewStyle => ({ ...rowStyle(false, focused, u(14)), height: cs(56), paddingHorizontal: cs(14) });
const boxStyle = (on: boolean, locked: boolean): ViewStyle => ({
  width: cs(24),
  height: cs(24),
  ...rounded(u(6)),
  alignItems: "center",
  justifyContent: "center",
  borderWidth: on ? 0 : 1.5,
  borderColor: colors.faint(),
  backgroundColor: on ? colors.snow() : "transparent",
  opacity: locked ? 0.4 : 1,
});

const dashStyle = (): ViewStyle => ({ width: cs(12), height: cs(2.5), ...rounded(999), backgroundColor: colors.ink() });

/** A checkbox: ticked (a dark check on white), some of it (a dash: part of a season), or empty. */
function Box(props: { on: () => boolean; locked: () => boolean; some?: () => boolean }) {
  return (
    <View style={boxStyle(props.on() || (props.some?.() ?? false), props.locked())}>
      <If when={props.on()} else={<If when={props.some?.()}><View style={dashStyle()} /></If>}>
        <Icon src={() => checkIcon} size={16} color={() => colors.ink()} />
      </If>
    </View>
  );
}

/** A row in the place of an episode while the season's episodes are coming. */
const skeletonRow = (): ViewStyle => ({
  height: cs(56),
  ...rounded(u(10)),
  backgroundColor: alpha(colors.snow(), 0.05),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});

function EpisodeLine(props: { e: () => PlanEpisode; picked: () => boolean; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const e = props.e;
  return (
    <Pressable feedback="row" haptic={!e().locked} ref={props.viewRef} role="checkbox" accessibilityLabel={e().title} accessibilityState={{ checked: e().locked || props.picked() }} hitSlop={targetSlop(cs(56))} onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={rowBox(props.focused())}>
      <Box on={() => e().locked || props.picked()} locked={() => e().locked} />
      <Text style={{ ...metaText(colors.faint()), width: cs(30), textAlign: "right" }}>{String(e().number)}</Text>
      <Text style={{ ...labelText(), ...oneLine, flex: 1 }}>{e().title}</Text>
      <Text style={metaText()}>{e().size != null ? Fmt.size(e().size!) : ""}</Text>
      {/* Saved, saving or being found: a round mark, as Apple's apps show a download. */}
      <View style={{ width: cs(34), alignItems: "flex-end" }}>
        <If when={e().locked}>
          <SaveMark state={() => e().state} progress={() => e().progress} background={() => (props.focused() ? colors.raise() : colors.card())} />
        </If>
      </View>
    </Pressable>
  );
}

export function SaveDrawer(props: {
  open: () => boolean;
  onClose: () => void;
  /** The show's seasons: number and episode count. */
  seasons: () => { number: number; episodes: number }[];
  season: () => number;
  onSeason: (n: number) => void;
  plan: () => SeasonPlan;
  /** The keys ticked to save (not yet saved). */
  picked: () => Set<string>;
  onToggle: (key: string) => void;
  onWhole: () => void;
  /** The focused row: 0 Whole season, 1.. the episodes, then the Save button; null: none. */
  focusedAt: () => number | null;
  onSave: () => void;
}) {
  const eps = () => props.plan().episodes;
  const fresh = () => eps().filter((e) => !e.locked && props.picked().has(e.key));
  /** The ticked episodes do not fit the free space (the core says; null: not known yet). */
  const tooBig = () => props.plan().picked.fits === false;
  /** Whole season: ticked when every episode is saved or ticked, a dash when some are. */
  const allOn = () => eps().length > 0 && eps().every((e) => e.locked || props.picked().has(e.key));
  const someOn = () => !allOn() && eps().some((e) => e.locked || props.picked().has(e.key));
  /** The season tabs scroll sideways (a show may have a dozen), the chosen one kept in view. */
  const tabs = scroller({ horizontal: true, anchor: () => 0 });
  /** Under the list: "4.5 GB · 19 GB free", "19 GB free" with nothing ticked, and when it does not
   * fit "Not enough space: needs 25 GB, 19 GB free". */
  const spaceLine = () => {
    const { size } = props.plan().picked;
    const free = props.plan().free;
    if (free == null) return size > 0 ? t("saved.drawer.more", { size: Fmt.size(size) }) : "";
    if (tooBig()) return t("saved.drawer.no_room", { size: Fmt.size(size), free: Fmt.size(free) });
    return size > 0 ? t("saved.drawer.more_free", { size: Fmt.size(size), free: Fmt.size(free) }) : t("saved.drawer.free", { free: Fmt.size(free) });
  };
  const saveLabel = () => (fresh().length === 0 ? t("saved.drawer.choose") : fresh().length === 1 ? t("saved.drawer.save_one") : t("saved.drawer.save_n", { count: fresh().length }));
  return (
    <Drawer
      id="save"
      open={props.open}
      onClose={props.onClose}
      title={() => t("saved.drawer.title")}
      note={() => t("saved.drawer.note")}
      tvWidth={760}
      // Save stays in view at the foot, whatever row the list is scrolled to.
      footer={() => (
        <View style={{ gap: u(10) }}>
          <If when={spaceLine()}>
            <Text style={metaText(tooBig() ? colors.red() : undefined)}>{spaceLine()}</Text>
          </If>
          <Button kind="primary" label={saveLabel} focused={() => props.focusedAt() === eps().length + 1} disabled={() => fresh().length === 0 || tooBig()} onPress={props.onSave} />
        </View>
      )}
    >
      {(list) => (
        <View style={{ gap: u(10) }}>
          <Scroller ctl={tabs}>
          <View style={row(u(6))}>
            <Each of={props.seasons()} key={(s) => String(s.number)}>
              {(s) => (
                <Pressable haptic={s().number !== props.season()} ref={tabs.follow(() => s().number === props.season(), "nearest")} role="tab" accessibilityState={{ selected: s().number === props.season() }} onPress={() => props.onSeason(s().number)} style={tabStyle(s().number === props.season())}>
                  <Text style={labelText(s().number === props.season() ? colors.snow() : colors.ash())}>{t("series.season", { number: s().number })}</Text>
                  <Text style={metaText()}>{s().number === props.season() && props.plan().saved > 0 ? t("saved.drawer.season_state", { saved: props.plan().saved, total: props.plan().total }) : t("saved.drawer.episodes", { count: s().episodes })}</Text>
                </Pressable>
              )}
            </Each>
          </View>
          </Scroller>
          <If when={props.plan().saved > 0}>
            <Text style={metaText()}>{t("saved.drawer.release_locked")}</Text>
          </If>
          <Pressable feedback="row" haptic ref={list.follow(() => props.focusedAt() === 0)} role="checkbox" accessibilityLabel={t("saved.drawer.whole_season")} onPress={props.onWhole} hoverStyle={{ backgroundColor: colors.raise() }} style={rowBox(props.focusedAt() === 0)}>
            <Box on={allOn} some={someOn} locked={() => false} />
            <Text style={{ ...labelText(), flex: 1, fontWeight: 600 }}>{t("saved.drawer.whole_season")}</Text>
            <Text style={metaText()}>{props.plan().size != null ? `${t("saved.drawer.episodes", { count: eps().length })} · ${Fmt.size(props.plan().size!)}` : t("saved.drawer.episodes", { count: eps().length })}</Text>
          </Pressable>
          {/* The season's episodes are coming: rows in their place, as many as it has. */}
          <If when={eps().length === 0}>
            <Each of={Array.from({ length: Math.min(12, props.seasons().find((s) => s.number === props.season())?.episodes ?? 6) }, (_, i) => i)} key={(i) => String(i)}>
              {() => <View style={skeletonRow()} />}
            </Each>
          </If>
          <Each of={eps()} key={(e) => e.key}>
            {(e, i) => (
              <EpisodeLine
                e={e}
                picked={() => props.picked().has(e().key)}
                focused={() => props.focusedAt() === i() + 1}
                viewRef={list.follow(() => props.focusedAt() === i() + 1)}
                onPress={() => !e().locked && props.onToggle(e().key)}
              />
            )}
          </Each>
        </View>
      )}
    </Drawer>
  );
}
