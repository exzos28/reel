// A title's releases: the short list (the most shared of each quality, best
// first) and, on Show more, the rest; OK makes one the one Play uses. While
// the source is searched, grey rows hold the list's place.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import type { Release } from "../../catalog";
import { rowStyle } from "../../kit/Row";
import { labelText } from "../../kit/text";
import type { Follow } from "../../layout/Scroller";
import { SectionHeader } from "../../layout/Section";
import { alpha, colors, safe, u } from "../../theme";
import { ReleaseRow } from "./ReleaseRow";

/** Grey rows while searching. */
const SKELETON_ROWS = 3;

const skeletonStyle = (): ViewStyle => ({
  ...rowStyle(false, false),
  height: u(76),
  backgroundColor: alpha(colors.snow(), 0.05),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});
const moreStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  height: u(68),
  paddingHorizontal: u(28),
  justifyContent: "center",
});

export function ReleaseList(props: {
  /** The releases shown: the short list, or all once expanded (a prefix of the title's). */
  releases: () => Release[];
  header: () => string;
  /** The section's title ("Releases" by default). */
  title?: () => string;
  /** Still searching: grey rows instead. */
  loading?: () => boolean;
  /** How many more Show more reveals (0: no button); it is the row after the releases. */
  more?: () => number;
  onMore?: () => void;
  focused: (i: number) => boolean;
  follow: Follow;
  onPress: (i: number) => void;
  /** In the side panel: no page inset, narrower rows. */
  inPanel?: boolean;
}) {
  const more = () => props.more?.() ?? 0;
  const moreAt = () => props.releases().length;
  return (
    <View style={props.inPanel ? undefined : { paddingHorizontal: safe().x, marginTop: u(40) }}>
      {/* In a drawer, the drawer shows the title and the note. */}
      <If when={!props.inPanel}>
        <SectionHeader title={props.title ?? (() => t("releases.title"))} note={props.header} />
      </If>
      <View style={{ gap: u(12), marginTop: u(20) }}>
        <If
          when={!props.loading?.()}
          else={
            <Each of={Array.from({ length: SKELETON_ROWS }, (_, i) => i)} key={(i) => i}>
              {() => <View testID="release-skeleton" style={skeletonStyle()} />}
            </Each>
          }
        >
          <Each of={props.releases()} key={(r) => r.index}>
            {(r, i) => (
              <ReleaseRow
                release={r}
                narrow={props.inPanel}
                focused={() => props.focused(i())}
                viewRef={props.follow(() => props.focused(i()))}
                onPress={() => props.onPress(i())}
              />
            )}
          </Each>
          <If when={more() > 0}>
            <View
              ref={props.follow(() => props.focused(moreAt()))}
              role="button"
              onPress={() => props.onMore?.()}
              hoverStyle={{ backgroundColor: colors.raise() }}
              style={moreStyle(props.focused(moreAt()))}
            >
              <Text style={labelText(colors.soft())}>{t("releases.more", { count: more() })}</Text>
            </View>
          </If>
        </If>
      </View>
    </View>
  );
}
