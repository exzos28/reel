// The player: the platform's video view on the local stream, with a quiet
// top bar (title, what the torrent is doing) and Esc to go back.
import { signal, Text, Video, View } from "nsh";
import { t } from "nsh/i18n";
import { filmText } from "../data";
import { playback, stop, transfer } from "./playback";
import { colors, fonts, safe, type, u } from "./theme";

export function Player() {
  const buffering = signal(true);
  const error = signal<string | null>(null);
  const p = playback;
  const url = () => { const s = p(); return s.phase === "ready" ? s.url : ""; };
  const film = () => { const s = p(); return s.phase === "idle" ? null : s.film; };

  const status = () => {
    const s = p();
    if (s.phase === "noSource") return t("player.no_source");
    if (s.phase === "failed") return t("player.failed", { message: s.message });
    if (s.phase === "resolving") return t("player.resolving");
    if (error()) return t("player.failed", { message: error()! });
    const tr = transfer();
    const peers = tr?.peers != null ? t("player.peers", { count: tr.peers }) : "";
    const speed = tr ? t("player.speed", { speed: tr.speed.toFixed(1) }) : "";
    const done = tr ? t("player.downloaded", { percent: Math.round(tr.progress * 100) }) : "";
    return [buffering() ? t("player.buffering") : "", done, speed, peers].filter(Boolean).join(", ");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <If when={p().phase === "ready"}>
        <Video
          src={url()}
          controls
          paused={false}
          onBuffer={(e) => buffering.set(e.isBuffering)}
          onLoad={() => buffering.set(false)}
          onError={(e) => error.set(e.message)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </If>
      <View style={{ paddingHorizontal: safe().x, paddingTop: safe().y, gap: u(8) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: u(24) }}>
          <View
            onPress={stop}
            role="button"
            style={{ borderRadius: 999, borderWidth: 2, borderColor: colors.line(), paddingHorizontal: u(28), paddingVertical: u(10) }}
          >
            <Text style={{ fontFamily: fonts.body, fontSize: u(28), color: colors.screen() }}>{t("player.back")}</Text>
          </View>
          <Text style={{ ...type.subtitle(), color: colors.screen() }}>
            {film() ? filmText(film()!, "title") : ""}
          </Text>
        </View>
        <Text style={{ ...type.caption(), color: colors.dim() }}>{status()}</Text>
      </View>
    </View>
  );
}
