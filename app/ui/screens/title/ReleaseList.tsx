// A film's releases, fastest to start first; OK makes one the one Play uses.
import { View } from "nsh";
import { t } from "nsh/i18n";
import type { Release } from "../../catalog";
import type { Follow } from "../../layout/Scroller";
import { SectionHeader } from "../../layout/Section";
import { safe, u } from "../../theme";
import { ReleaseRow } from "./ReleaseRow";

export function ReleaseList(props: {
  releases: () => Release[];
  header: () => string;
  focused: (i: number) => boolean;
  follow: Follow;
  onPress: (i: number) => void;
}) {
  return (
    <View style={{ paddingHorizontal: safe().x, marginTop: u(40) }}>
      <SectionHeader title={() => t("releases.title")} note={props.header} />
      <View style={{ gap: u(12), marginTop: u(20) }}>
        <Each of={props.releases()} key={(r) => r.index}>
          {(r, i) => (
            <ReleaseRow
              release={r}
              focused={() => props.focused(i())}
              viewRef={props.follow(() => props.focused(i()))}
              onPress={() => props.onPress(i())}
            />
          )}
        </Each>
      </View>
    </View>
  );
}
