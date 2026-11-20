// The cast as a row of round photos with the name and the part under each;
// the initials on a plain disc where there is no photo. The remote walks it
// left and right; OK or a tap opens the person's page (their titles). One reel
// has no page for (AniList's staff) is shown, not pressable.
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

/** The photo (or the initials), the name and the part. */
function Face(props: { person: () => CastMember; focused: () => boolean }) {
  const p = props.person;
  return (
    <>
      <View style={discStyle(props.focused())}>
        <If when={p().photo} else={<Text style={fontText(44, colors.ash(), 300)}>{p().initials}</Text>}>
          <Image src={p().photo!} style={photoStyle} />
        </If>
      </View>
      <Text style={nameStyle()}>{p().name}</Text>
      <If when={p().character}>
        <Text style={partStyle()}>{p().character!}</Text>
      </If>
    </>
  );
}

function Person(props: { person: () => CastMember; focused: () => boolean; follow: Follow; onPress: () => void }) {
  const p = props.person;
  const ref = props.follow(props.focused) as (r: ViewRef) => void;
  return (
    <If
      when={p().person}
      else={
        <View ref={ref} accessibilityLabel={p().name} style={personBox()}>
          <Face person={p} focused={props.focused} />
        </View>
      }
    >
      <Pressable ref={ref} role="button" accessibilityLabel={p().name} onPress={props.onPress} style={personBox()}>
        <Face person={p} focused={props.focused} />
      </Pressable>
    </If>
  );
}

export function CastRow(props: { cast: () => CastMember[]; focusedAt: () => number | null; onOpen: (i: number) => void }) {
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
              onPress={() => props.onOpen(i())}
            />
          )}
        </Each>
      </Rail>
    </View>
  );
}
