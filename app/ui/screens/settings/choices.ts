// The choices Settings and the first-run setup offer: the languages of titles, the buffer sizes.
import { t } from "nsh/i18n";
import type { Choice } from "../../layout/ChoicePanel";
import { Fmt } from "../../native";
import { bufferChoices, bufferMB, contentLanguage, contentLanguages } from "../../preferences";

const MIB = 1024 * 1024;
export const sizeText = (mb: number) => Fmt.size(mb * MIB);

/** The language in effect, named in itself. */
export const languageName = () => contentLanguages().find((l) => l.tag === contentLanguage())?.name ?? contentLanguage();

/** The languages, each named in itself, the one in effect selected. */
export const languageChoices = (): Choice[] =>
  contentLanguages().map((l) => ({ key: l.tag, text: l.name, selected: l.tag === contentLanguage() }));

/** The sizes this device has room for ("512 MB  Recommended"), the one in effect selected. */
export const bufferChoiceList = (): Choice[] =>
  bufferChoices().map((c) => ({
    key: String(c.mb),
    text: c.default ? `${sizeText(c.mb)}  ${t("setup.buffer.recommended")}` : sizeText(c.mb),
    selected: c.mb === bufferMB(),
  }));
