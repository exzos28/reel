// "Set it up on your phone": the QR code and the address of the settings page this device serves
// (a TV: typing with a remote is slow). Nothing where there is none (a phone, a desktop).
import { Image, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { rounded } from "../../kit/shape";
import { bodyText, oneLine, sectionTitle } from "../../kit/text";
import { hostedQr, hostedUrl } from "../../hosted";
import { colors, cs, u } from "../../theme";

const cardStyle = (): ViewStyle => ({ width: u(560), padding: u(44), gap: u(28), ...rounded(), backgroundColor: colors.card() });
const qrStyle = () => ({ width: cs(300), height: cs(300), ...rounded() });
/** The text and, under it, the address it points to. */
const howStyle = (): ViewStyle => ({ gap: u(8) });
/** The address is typed letter by letter: one line, never broken inside (a browser's or a TV's
 * text would break a long one anywhere, "http://1 / 92.168…"), smaller where the card is too narrow
 * for it, down to `ADDRESS_MIN_SCALE`. */
const ADDRESS_MIN_SCALE = 0.5;
const addressText = (): TextStyle => ({ ...bodyText(colors.ash()), ...oneLine });

/** `text` says how; the address goes on its own line under it. */
export function PhoneCard(props: { title: () => string; text: () => string }) {
  return (
    <If when={hostedUrl() && hostedQr()}>
      <View testID="phone-card" style={cardStyle()}>
        <Image testID="hosted-qr" src={hostedQr()!} style={qrStyle()} />
        <Text style={sectionTitle()}>{props.title()}</Text>
        <View style={howStyle()}>
          <Text style={bodyText(colors.ash())}>{props.text()}</Text>
          <Text testID="phone-address" adjustsFontSizeToFit minimumFontScale={ADDRESS_MIN_SCALE} style={addressText()}>
            {hostedUrl()!}
          </Text>
        </View>
      </View>
    </If>
  );
}
