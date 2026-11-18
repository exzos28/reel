// How a torrent comes in, in few words: "21 MB/s" and a person with the number of people
// sharing it.
import { Text, View } from "nsh";
import { Icon } from "./Icon";
import { row } from "./shape";
import { metaText } from "./text";
import { Fmt } from "../native";
import { colors, u } from "../theme";
import personIcon from "../icons/person.svg";

export function SpeedLine(props: { speed: () => number; peers: () => number }) {
  return (
    <View style={{ ...row(u(10)), marginTop: u(6) }}>
      <Text style={metaText()}>{Fmt.speed(props.speed())}</Text>
      <View style={row(u(4))}>
        <Icon src={() => personIcon} size={16} color={() => colors.ash()} />
        <Text style={metaText()}>{String(props.peers())}</Text>
      </View>
    </View>
  );
}
