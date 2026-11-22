// A TrackSlider alone, for TrackSlider.test.tsx: 300 points wide, at 0.2, its events as texts.
import { mount, signal, Text, View } from "nsh";
import { TrackSlider } from "../ui/kit/TrackSlider";

const show = (v: number | null) => (v == null ? "none" : v.toFixed(2));

function SliderApp() {
  const value = signal(0.2);
  const scrub = signal<number | null>(null);
  const held = signal(false);
  const commits = signal(0);
  return (
    <View style={{ flex: 1, padding: 40, backgroundColor: "#000" }}>
      <TrackSlider
        testID="slider"
        accessibilityLabel="Level"
        valueText={() => `${Math.round(value() * 100)}%`}
        value={value}
        onScrub={(v) => scrub.set(v)}
        onCommit={(v) => (value.set(v), commits.set(commits() + 1))}
        onHold={(h) => held.set(h)}
        onStep={(dir) => value.set(Math.min(1, Math.max(0, value() + dir * 0.1)))}
        track={6}
        thumb={20}
        height={20}
        style={{ width: 300 }}
      />
      <Text>{`value ${show(value())}`}</Text>
      <Text>{`scrub ${show(scrub())}`}</Text>
      <Text>{held() ? "held" : "free"}</Text>
      <Text>{`commits ${commits()}`}</Text>
    </View>
  );
}

mount(SliderApp);
