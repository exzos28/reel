import { expect, open, test } from "nsh/test";
import { ENGINE } from "./testEngine";

const SOURCE = {
  ...ENGINE,
  "Settings.setSource": JSON.stringify({ ok: true, source: { url: "http://127.0.0.1:9117/api", hasKey: true } }),
  "Sources.check": 7,
  "Sources.result": JSON.stringify({ state: "done", caps: { movieImdb: false, tvImdb: false, tvSeasonEp: true } }),
};

test("Settings: saving a search source checks it and says how it searches", async () => {
  const app = await open("./App.tsx", { clock: {}, modules: { "app/native": SOURCE } });
  await app.press("label:Settings");
  expect(app.texts()).toContain("Search source");
  await app.press("Save and check");
  await app.wait(400);
  expect(app.texts()).toContain("Connected. It searches by title.");
});

test("Settings: a bad address is refused with the core's message", async () => {
  const app = await open("./App.tsx", {
    modules: { "app/native": { ...SOURCE, "Settings.setSource": JSON.stringify({ ok: false, message: "not an address" }) } },
  });
  await app.press("label:Settings");
  await app.press("Save and check");
  expect(app.texts()).toContain("not an address");
});
