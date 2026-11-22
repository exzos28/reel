// A list of choices in a drawer (as the filter and release panels are): a title,
// one row per choice, the chosen one lighter with a check. OK or a click picks;
// Back (through the page's closer), ✕ or a press outside closes it.
//
// On a tablet a short choice is not a sheet the screen's height: it is a popover (design/
// navigation.md, "Panels"), a card 320 points wide and as tall as its rows, under (or over,
// where there is more room) what opened it (`anchor`: a setting's row, a filter's pill), its
// right edge at the anchor's; without an anchor in the middle of the screen. A press beside it,
// Escape or the keyboard's Back closes it.
import { Overlay, signal, Text, View, windowSize, type ViewRef, type ViewStyle } from "nsh";
import { Icon } from "../kit/Icon";
import { rowStyle } from "../kit/Row";
import { rounded } from "../kit/shape";
import { labelText, metaText } from "../kit/text";
import { alpha, colors, cs, u } from "../theme";
import checkIcon from "../icons/check.svg";
import { frame } from "./chrome";
import { Drawer } from "./Drawer";
import { scroller, Scroller, type ScrollCtl } from "./Scroller";
import { Pressable } from "../kit/Pressable";

/** A tablet's: a popover, not a sheet. */
const popover = () => frame().panel === "floating-sheet";
/** The popover's width, its rows' most and its room from the screen's edges and the anchor, points. */
const POP_WIDTH = 320;
const POP_ROWS_MOST = 0.55;
const POP_MARGIN = 12;
const POP_GAP = 8;
/** The backdrop's overlay: a fixed box over the whole screen. */
const popCover: ViewStyle = { top: 0, left: 0, right: 0, bottom: 0 };
const popBackdrop = (): ViewStyle => ({ flex: 1, backgroundColor: alpha(colors.ink(), 0.3) });
/** Without an anchor the card's overlay is a fixed box in the middle across, a fifth down. */
const popMiddle = (): ViewStyle => ({ left: (windowSize().width - POP_WIDTH) / 2, top: windowSize().height * 0.2 });
const popCard = (): ViewStyle => ({
  width: POP_WIDTH,
  ...rounded(14),
  backgroundColor: colors.card(),
  borderWidth: 1,
  borderColor: alpha(colors.snow(), 0.08),
  boxShadow: `0 12px 40px ${alpha(colors.ink(), 0.6)}`,
  overflow: "hidden",
});
const popHead = (): ViewStyle => ({ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 4 });

const optionStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused, u(16)),
  height: cs(68),
  paddingHorizontal: cs(28),
  justifyContent: "space-between",
});

export interface Choice {
  key: string;
  text: string;
  selected: boolean;
}

/** Where the focus starts in a list of choices: on the one in effect (the first when none is). */
export const selectedAt = (choices: Choice[]) => Math.max(0, choices.findIndex((c) => c.selected));

function ChoiceRow(props: { choice: () => Choice; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const c = props.choice;
  return (
    <Pressable feedback="row" haptic={!c().selected}
      ref={props.viewRef}
      role="button"
      accessibilityLabel={c().text}
      accessibilityState={{ selected: c().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={optionStyle(c().selected, props.focused())}
    >
      <Text style={labelText(c().selected ? colors.snow() : colors.soft())}>{c().text}</Text>
      <If when={c().selected}>
        <Icon src={() => checkIcon} size={22} />
      </If>
    </Pressable>
  );
}

type Props = {
  title: () => string;
  choices: () => Choice[];
  focusedAt: () => number;
  onPick: (i: number) => void;
  onClose: () => void;
  /** One line over the choices: what the setting does. */
  note?: () => string;
  /** Test ids (`<id>-panel`, …); "choice" by default. */
  id?: string;
  /** What opened it (a row, a pill): a tablet's popover goes beside it. */
  anchor?: () => ViewRef | undefined;
};

function Rows(props: Props & { list: ScrollCtl }) {
  return (
    <Each of={props.choices()} key={(c) => c.key}>
      {(c, i) => (
        <ChoiceRow
          choice={c}
          focused={() => props.focusedAt() === i()}
          viewRef={props.list.follow(() => props.focusedAt() === i())}
          onPress={() => props.onPick(i())}
        />
      )}
    </Each>
  );
}

/** A tablet's popover: the title and the note small over the rows, which scroll past
 * `POP_ROWS_MOST` of the screen's height. */
function Popover(props: Props) {
  const id = props.id ?? "choice";
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  /** The rows' height as they lay out (0 until then). */
  const rows = signal(0);
  const most = () => windowSize().height * POP_ROWS_MOST;
  const anchor = props.anchor?.();
  return [
    <Overlay style={popCover}>
      <Pressable feedback="none" testID={`${id}-backdrop`} accessibilityLabel={props.title()} onPress={props.onClose} style={popBackdrop()} />
    </Overlay>,
    <Overlay anchor={anchor ?? null} placement="bottom" align="end" offset={POP_GAP} margin={POP_MARGIN} onCancel={props.onClose} style={anchor ? undefined : popMiddle()}>
      <View testID={`${id}-panel`} style={popCard()}>
        <View style={popHead()}>
          <Text style={labelText()}>{props.title()}</Text>
          <If when={props.note?.()}>
            <Text style={metaText()}>{props.note!()}</Text>
          </If>
        </View>
        <Scroller ctl={list} style={{ height: rows() ? Math.min(rows(), most()) : most() }} onContent={rows.set}>
          <View style={{ paddingHorizontal: 6, paddingBottom: 6, gap: 2 }}>
            <Rows {...props} list={list} />
          </View>
        </Scroller>
      </View>
    </Overlay>,
  ];
}

export function ChoicePanel(props: Props) {
  if (popover()) return <Popover {...props} />;
  return (
    <Drawer id={props.id ?? "choice"} open={() => true} onClose={props.onClose} title={props.title} note={props.note}>
      {(list) => <Rows {...props} list={list} />}
    </Drawer>
  );
}
