// The releases of what Play starts (the film, or the show's episode), in a
// drawer (layout/Drawer.tsx: at the right on a TV and a desktop, from the bottom
// on a phone). The short list, Show more for the rest. OK or a tap on one makes
// it the one Play uses; Back, ✕ or a press outside closes it.
import { Text } from "nsh";
import type { Release } from "../../catalog";
import { bodyText } from "../../kit/text";
import { Drawer } from "../../layout/Drawer";
import { colors, u } from "../../theme";
import { ReleaseList } from "./ReleaseList";

type Props = {
  /** Shown. */
  open: () => boolean;
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
};

export function ReleasePanel(props: Props) {
  return (
    <Drawer id="releases" open={props.open} onClose={props.onClose} title={props.title} note={props.header} tvWidth={1080}>
      {(list) => [
        <If when={props.message?.()}>
          <Text style={{ ...bodyText(colors.snow()), maxWidth: u(900) }}>{props.message!()}</Text>
        </If>,
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
        />,
      ]}
    </Drawer>
  );
}
