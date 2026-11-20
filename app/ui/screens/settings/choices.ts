// The choices Settings and the first-run setup offer: the languages of titles, the buffer sizes.
import { t } from "nsh/i18n";
import type { Choice } from "../../layout/ChoicePanel";
import { Fmt } from "../../native";
import {
  audioLanguage, audioLanguages, bufferChoices, bufferMB, contentLanguage, contentLanguages, loader, LOADERS, navPosition, NAV_POSITIONS,
} from "../../preferences";

const MIB = 1024 * 1024;
export const sizeText = (mb: number) => Fmt.size(mb * MIB);

/** The language in effect, named in itself. */
export const languageName = () => contentLanguages().find((l) => l.tag === contentLanguage())?.name ?? contentLanguage();

/** The languages, each named in itself, the one in effect selected. */
export const languageChoices = (): Choice[] =>
  contentLanguages().map((l) => ({ key: l.tag, text: l.name, selected: l.tag === contentLanguage() }));

/** The audio language in effect: the app's, or the one picked. */
export const audioLanguageName = () =>
  audioLanguage() ? t(`languages.${audioLanguage()}`) : t("settings.audio_language.same");

/** The app's language first, then the languages a track can be in, the one in effect selected. */
export const audioLanguageChoices = (): Choice[] => [
  { key: "", text: t("settings.audio_language.same"), selected: audioLanguage() === "" },
  ...audioLanguages().map((l) => ({ key: l, text: t(`languages.${l}`), selected: l === audioLanguage() })),
];

/** Where the menu sits, the one in effect selected. */
export const navPositionName = () => t(`settings.nav_position.${navPosition()}`);
export const navPositionChoices = (): Choice[] =>
  NAV_POSITIONS.map((p) => ({ key: p, text: t(`settings.nav_position.${p}`), selected: p === navPosition() }));

/** The loading animations, the one in effect selected. */
export const loaderName = () => t(`settings.loader.${loader()}`);
export const loaderChoices = (): Choice[] => LOADERS.map((l) => ({ key: l, text: t(`settings.loader.${l}`), selected: l === loader() }));

/** The sizes this device has room for ("512 MB  Recommended"), the one in effect selected. */
export const bufferChoiceList = (): Choice[] =>
  bufferChoices().map((c) => ({
    key: String(c.mb),
    text: c.default ? `${sizeText(c.mb)}  ${t("setup.buffer.recommended")}` : sizeText(c.mb),
    selected: c.mb === bufferMB(),
  }));
