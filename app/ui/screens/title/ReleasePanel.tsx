// The releases of what Play starts (the film, or the show's episode), in a
// panel over the right of the title screen: the short list, Show more for the
// rest. OK on one makes it the one Play uses; Back or a press outside closes it.
import { Text, View, type ViewStyle } from "nsh";
import { bodyText } from "../../kit/text";
import type { Release } from "../../catalog";
import { scroller, Scroller } from "../../layout/Scroller";
import { alpha, colors, safe, u } from "../../theme";
import { ReleaseList } from "./ReleaseList";

const PANEL_WIDTH = 1080;

const backdropStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: alpha(colors.ink(), 0.6),
});
const panelStyle = (): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width: u(PANEL_WIDTH), zIndex: 21,
  backgroundColor: colors.ink(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08),
  boxShadow: `${-u(30)}px 0 ${u(60)}px ${alpha(colors.ink(), 0.8)}`,
});

export function ReleasePanel(props: {
  title: () => string;
  header: () => string;
  /** A line over the list (why it opened), empty for none. */
  message?: () => string;
  releases: () => Release[];
  loading: () => boolean;
  more: () => number;
  onMore: () => void;
  focusedAt: () => number;
  onPress: (i: number) => void;
  onClose: () => void;
}) {
  /** The panel keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  return [
    <View testID="releases-backdrop" style={backdropStyle()} onPress={props.onClose} />,
    <View testID="releases-panel" style={panelStyle()}>
      <Scroller ctl={list} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: u(48), paddingTop: safe().y, paddingBottom: safe().y, gap: u(24) }}>
          <If when={props.message?.()}>
            <Text style={{ ...bodyText(colors.snow()), maxWidth: u(900) }}>{props.message!()}</Text>
          </If>
          <ReleaseList
            inPanel
            title={props.title}
            header={props.header}
            releases={props.releases}
            loading={props.loading}
            more={props.more}
            onMore={props.onMore}
            focused={(i) => props.focusedAt() === i}
            follow={list.follow}
            onPress={props.onPress}
          />
        </View>
      </Scroller>
    </View>,
  ];
}
