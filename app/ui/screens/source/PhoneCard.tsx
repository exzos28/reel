// "Set it up on your phone": the QR code and the address of the settings page this device serves
// (a TV: typing with a remote is slow). Nothing where there is none (a phone, a desktop).
import { Image, Text, View, type ViewStyle } from "nsh";
import { rounded } from "../../kit/shape";
import { bodyText, sectionTitle } from "../../kit/text";
import { hostedQr, hostedUrl } from "../../hosted";
import { colors, cs, u } from "../../theme";

const cardStyle = (): ViewStyle => ({ width: u(560), padding: u(44), gap: u(28), ...rounded(), backgroundColor: colors.card() });
const qrStyle = () => ({ width: cs(300), height: cs(300), ...rounded() });

/** `text` gets the page's address. */
export function PhoneCard(props: { title: () => string; text: (url: string) => string }) {
  return (
    <If when={hostedUrl() && hostedQr()}>
      <View testID="phone-card" style={cardStyle()}>
        <Image testID="hosted-qr" src={hostedQr()!} style={qrStyle()} />
        <Text style={sectionTitle()}>{props.title()}</Text>
        <Text style={{ ...bodyText(colors.ash()) }}>{props.text(hostedUrl()!)}</Text>
      </View>
    </If>
  );
}
