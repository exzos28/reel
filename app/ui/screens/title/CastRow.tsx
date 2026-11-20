// The cast as a row of round photos with the name and the part under each;
// the initials on a plain disc where there is no photo. The remote walks it
// left and right; nothing opens (reel has no person pages).
import { Image, Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import type { CastMember } from "../../catalog";
import { fontText, labelText, metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { scroller, type Follow } from "../../layout/Scroller";
import { Rail, railLead } from "../../layout/Rail";
import { colors, focusRing, ts, u } from "../../theme";
import { Pressable } from "../../kit/Pressable";

const PHOTO = 150;

const personBox = (): ViewStyle => ({ width: u(PHOTO + 30), flexShrink: 0, alignItems: "center", gap: u(6) });
const discStyle = (focused: boolean): ViewStyle => ({
  width: u(PHOTO),
  height: u(PHOTO),
  borderRadius: u(PHOTO),
  overflow: "hidden",
  backgroundColor: colors.card(),
  alignItems: "center",
  justifyContent: "center",
  marginBottom: u(8),
  ...focusRing(focused, "card"),
});
const photoStyle = { width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" } as ViewStyle;
const nameStyle = (): TextStyle => ({ ...labelText(), fontSize: ts(22), numberOfLines: 2, textAlign: "center" });
const partStyle = (): TextStyle => ({ ...metaText(), fontSize: ts(20), numberOfLines: 2, textAlign: "center" });

function Person(props: { person: () => CastMember; focused: () => boolean; follow: Follow; onPress: () => void }) {
  const p = props.person;
  return (
    <Pressable
      ref={props.follow(props.focused) as (r: ViewRef) => void}
      role="button"
      accessibilityLabel={p().name}
      onPress={props.onPress}
      style={personBox()}
    >
      <View style={discStyle(props.focused())}>
        <If when={p().photo} else={<Text style={fontText(44, colors.ash(), 300)}>{p().initials}</Text>}>
          <Image src={p().photo!} style={photoStyle} />
        </If>
      </View>
      <Text style={nameStyle()}>{p().name}</Text>
      <If when={p().character}>
        <Text style={partStyle()}>{p().character!}</Text>
      </If>
    </Pressable>
  );
}

export function CastRow(props: { cast: () => CastMember[]; focusedAt: () => number | null; onFocus: (i: number) => void }) {
  /** The row puts the focused person at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: railLead });
  return (
    <View style={{ gap: u(18) }}>
      <SectionTitle text={() => t("about.cast")} inset rail={line} />
      <Rail ctl={line} gap={20} top={0} bottom={8}>
        <Each of={props.cast()} key="index">
          {(p, i) => (
            <Person
              person={p}
              focused={() => props.focusedAt() === i()}
              follow={line.follow}
              onPress={() => props.onFocus(i())}
            />
          )}
        </Each>
      </Rail>
    </View>
  );
}
