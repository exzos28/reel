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
import { Fmt } from "../../native";
import type { PlanEpisode, SeasonPlan } from "../../library";
import { colors, cs, targetSlop, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

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

/** A checkbox: ticked (a dark check on white), or empty. */
function Box(props: { on: () => boolean; locked: () => boolean }) {
  return (
    <View style={boxStyle(props.on(), props.locked())}>
      <If when={props.on()}>
        <Icon src={() => checkIcon} size={16} color={() => colors.ink()} />
      </If>
    </View>
  );
}

/** Its state on the right: Saved, 62%, new (ticked, not saved yet), or nothing. */
function stateText(e: PlanEpisode, picked: boolean) {
  if (e.state === "saved") return t("title.saved");
  if (e.state === "saving" || e.state === "paused") return `${Math.floor(e.progress * 100)}%`;
  if (e.locked) return t(`saved.state.${e.state}`);
  return picked ? t("saved.drawer.new") : "";
}

function EpisodeLine(props: { e: () => PlanEpisode; picked: () => boolean; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const e = props.e;
  return (
    <View ref={props.viewRef} role="checkbox" accessibilityLabel={e().title} accessibilityState={{ checked: e().locked || props.picked() }} hitSlop={targetSlop(cs(56))} onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={rowBox(props.focused())}>
      <Box on={() => e().locked || props.picked()} locked={() => e().locked} />
      <Text style={{ ...metaText(colors.faint()), width: cs(30), textAlign: "right" }}>{String(e().number)}</Text>
      <Text style={{ ...labelText(), ...oneLine, flex: 1 }}>{e().title}</Text>
      <Text style={metaText()}>{e().size != null ? Fmt.size(e().size!) : ""}</Text>
      <Text style={{ ...metaText(e().state === "saved" ? colors.snow() : colors.ash()), width: cs(90), textAlign: "right" }}>{stateText(e(), props.picked())}</Text>
    </View>
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
  const more = () => fresh().reduce((s, e) => s + (e.size ?? 0), 0);
  const someOn = () => eps().some((e) => e.locked || props.picked().has(e.key));
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
          <If when={more() > 0}>
            <Text style={metaText()}>{t("saved.drawer.more", { size: Fmt.size(more()) })}</Text>
          </If>
          <Button kind="primary" label={saveLabel} focused={() => props.focusedAt() === eps().length + 1} disabled={() => fresh().length === 0} onPress={props.onSave} />
        </View>
      )}
    >
      {(list) => (
        <View style={{ gap: u(10) }}>
          <View style={row(u(6))}>
            <Each of={props.seasons()} key={(s) => String(s.number)}>
              {(s) => (
                <View role="tab" accessibilityState={{ selected: s().number === props.season() }} onPress={() => props.onSeason(s().number)} style={tabStyle(s().number === props.season())}>
                  <Text style={labelText(s().number === props.season() ? colors.snow() : colors.ash())}>{t("series.season", { number: s().number })}</Text>
                  <Text style={metaText()}>{s().number === props.season() && props.plan().saved > 0 ? t("saved.drawer.season_state", { saved: props.plan().saved, total: props.plan().total }) : t("saved.drawer.episodes", { count: s().episodes })}</Text>
                </View>
              )}
            </Each>
          </View>
          <If when={props.plan().saved > 0}>
            <Text style={metaText()}>{t("saved.drawer.release_locked")}</Text>
          </If>
          <View ref={list.follow(() => props.focusedAt() === 0)} role="checkbox" accessibilityLabel={t("saved.drawer.whole_season")} onPress={props.onWhole} hoverStyle={{ backgroundColor: colors.raise() }} style={rowBox(props.focusedAt() === 0)}>
            <Box on={someOn} locked={() => false} />
            <Text style={{ ...labelText(), flex: 1, fontWeight: 600 }}>{t("saved.drawer.whole_season")}</Text>
            <Text style={metaText()}>{props.plan().size != null ? `${t("saved.drawer.episodes", { count: eps().length })} · ${Fmt.size(props.plan().size!)}` : t("saved.drawer.episodes", { count: eps().length })}</Text>
          </View>
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
