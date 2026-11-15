import { Input } from "nsh/base";
import { View, type InputRef, type TextStyle, type ViewStyle, type InputStyle } from "nsh";
import { t } from "nsh/i18n";
import searchIcon from "../../icons/search.svg";
import { Icon } from "../../kit/Icon";
import { rounded, row } from "../../kit/shape";
import { colors, cs, focusRing, type, u } from "../../theme";

const boxStyle = (focused: boolean): ViewStyle => ({
  ...row(u(18)),
  flex: 1,
  maxWidth: u(1100),
  height: cs(72),
  paddingHorizontal: cs(26),
  ...rounded(),
  backgroundColor: focused ? colors.raise() : colors.card(),
  ...focusRing(focused, "row"),
});
// The placeholder in the theme's grey: Android drew it dark on the dark field.
const inputStyle = (): InputStyle => ({ flex: 1, height: cs(72), color: colors.snow(), placeholderColor: colors.ash(), ...type.body() });

/** The query field: a magnifier and the text. `focused`: the remote's focus
 * is on it (the ring); typing needs the input's own focus (`onRef`'s
 * `focus()`, which opens the on-screen keyboard on a TV). */
export function SearchField(props: {
  value: () => string;
  focused: () => boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onRef: (r: InputRef) => void;
}) {
  return (
    <View style={boxStyle(props.focused())}>
      <Icon src={() => searchIcon} size={30} color={colors.ash} />
      <Input
        ref={props.onRef}
        testID="search-field"
        value={props.value()}
        onChange={(e) => props.onChange(e.value)}
        onSubmit={props.onSubmit}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        placeholder={t("search.placeholder")}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle()}
      />
    </View>
  );
}
