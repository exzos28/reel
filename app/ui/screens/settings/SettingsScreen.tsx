// Settings: Playback (buffer size), Search source (the user's Jackett) and
// About reel. Up/down move the focus in the buffer list and on to About,
// OK chooses (or opens About), Back closes. A click chooses too; the source
// fields take text (on a TV, entering it from a phone comes later).
import { keymap, signal, Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { clamp } from "../../focus/memory";
import { rowStyle } from "../../kit/Row";
import { labelText, metaText } from "../../kit/text";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { PageHeader } from "../../layout/TopBar";
import { openAbout } from "../../nav";
import { bufferChoices, bufferMB, chooseBuffer } from "../../preferences";
import { colors, safe, u } from "../../theme";
import { BufferSection } from "./BufferSection";
import { SourceSection } from "./SourceSection";

const aboutRow = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  height: u(68),
  paddingHorizontal: u(28),
  maxWidth: u(720),
});

/** The row that opens About reel (its data sources and their notices). */
function AboutRow(props: { focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  return (
    <View
      ref={props.viewRef}
      role="button"
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={aboutRow(props.focused())}
    >
      <Text style={labelText()}>{t("settings.about.open")}</Text>
    </View>
  );
}

const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: safe().y, gap: u(32) });

/** Back from About finds the focus on its row. */
let backFromAbout = false;

export function SettingsScreen(props: { freeBytes: () => number | null; onClose: () => void }) {
  /** The focus goes through the buffer sizes, then to About. */
  const aboutAt = () => bufferChoices().length;
  const focus = signal(backFromAbout ? aboutAt() : Math.max(0, bufferChoices().findIndex((c) => c.mb === bufferMB())));
  backFromAbout = false;
  const about = () => {
    focus.set(aboutAt());
    backFromAbout = true;
    openAbout();
  };
  const move = (d: number) => focus.set(clamp(focus() + d, aboutAt()));

  keymap.bind({ up: () => move(-1), down: () => move(1) }, { repeat: true });
  keymap.bind({
    enter: () => (focus() === aboutAt() ? about() : chooseBuffer(bufferChoices()[focus()].mb)),
    escape: props.onClose,
  });

  /** The page shows the focused row whole. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });
  return (
    <Screen ctl={page}>
      <View style={pageStyle()}>
        <PageHeader title={() => t("settings.title")} focused={() => false} onBack={props.onClose} />
        <BufferSection freeBytes={props.freeBytes} focusedAt={focus} onFocus={(i) => focus.set(i)} />
        <SourceSection />
        <Text style={metaText()}>{t("settings.hint")}</Text>
        <AboutRow focused={() => focus() === aboutAt()} viewRef={page.follow(() => focus() === aboutAt(), "nearest")} onPress={about} />
      </View>
    </Screen>
  );
}
