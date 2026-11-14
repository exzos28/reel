// A title screen below the hero: About with the crew, the cast, the details,
// More like this; the scores with their sources and the age rating; the
// remote walking through them.
import { expect, open, test } from "nsh/test";
import { ENGINE, NATIVE, SHOW } from "./testEngine";

type Native = Record<string, {} | null | ((...args: any[]) => unknown)>;
const app_ = (native: Native = NATIVE) => open("./App.tsx", { modules: { "app/native": native } });

/** Home opens on Continue watching, Inception first. */
async function inception(native: Native = NATIVE) {
  const app = await app_(native);
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Releases");
  return app;
}

test("a film shows its scores, age rating, crew, cast, details and More like this", async () => {
  const app = await inception();
  const texts = app.texts();
  for (const s of ["TMDB", "8.4", "38K votes", "PG-13"]) expect(texts).toContain(s);
  for (const s of ["About", "Director", "Christopher Nolan", "Music", "Hans Zimmer"]) expect(texts).toContain(s);
  expect(texts).toContain("A thief who steals secrets through dreams is offered a way home.");
  for (const s of ["Cast", "Leonardo DiCaprio", "Cobb", "JG", "Arthur"]) expect(texts).toContain(s);
  for (const s of ["Details", "Tagline", "Your mind is the scene of the crime.", "Release date", "Jul 15, 2010"])
    expect(texts).toContain(s);
  for (const s of ["Runtime", "Country", "United Kingdom, United States", "Studio", "Legendary Pictures, Syncopy"])
    expect(texts).toContain(s);
  expect(texts).toContain("More like this");
  expect(texts).toContain("Dune");
  // In that order, under the releases.
  const at = (s: string) => texts.indexOf(s);
  expect(at("Releases")).toBeLessThan(at("About"));
  expect(at("About")).toBeLessThan(at("Cast"));
  expect(at("Cast")).toBeLessThan(at("Details"));
  expect(at("Details")).toBeLessThan(at("More like this"));
});

test("a series keeps its episodes right under the hero and names its creator, status and every score", async () => {
  const app = await app_({ ...ENGINE, ...SHOW });
  await app.keyboard.press("right"); // Attack on Titan
  await app.keyboard.press("enter");
  const texts = app.texts();
  for (const s of ["AniList", "84%", "MAL", "8.54", "2.4M votes", "TV-MA"]) expect(texts).toContain(s);
  for (const s of ["Created by", "Hajime Isayama", "Status", "Ended", "First aired", "Apr 7, 2013", "Network and studios"])
    expect(texts).toContain(s);
  const at = (s: string) => texts.indexOf(s);
  expect(at("22 episodes · Season 3")).toBeLessThan(at("About"));
  expect(at("Old Story")).toBeLessThan(at("Cast"));
  expect(at("Cast")).toBeLessThan(at("More like this"));
  expect(texts).toContain("Frieren: Beyond Journey's End");
});

test("the remote goes from the releases to the cast, then More like this, which opens a title; Back finds the focus", async () => {
  const chosen: number[] = [];
  const app = await inception({
    ...NATIVE,
    "Catalog.chooseRelease": (_id: string, index: number) => {
      chosen.push(index);
      return true;
    },
  });
  for (let i = 0; i < 3; i++) await app.keyboard.press("down"); // the three releases
  await app.keyboard.press("down"); // the cast
  await app.keyboard.press("right");
  await app.keyboard.press("enter"); // nothing opens on a person
  expect(chosen).toEqual([]);
  await app.keyboard.press("down"); // More like this, on Dune
  await app.keyboard.press("enter"); // opens it (the stand-in answers every title with Inception)
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("More like this"); // back on Inception, not Home
  await app.keyboard.press("up"); // the cast
  await app.keyboard.press("up"); // the release the focus left
  await app.keyboard.press("enter");
  expect(chosen).toEqual([2]);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("a film without releases goes from Play straight to the cast", async () => {
  const app = await inception({ ...NATIVE, "Catalog.title": JSON.stringify({ ...JSON.parse(NATIVE["Catalog.title"] as string), releases: [] }) });
  await app.keyboard.press("down"); // the cast
  await app.keyboard.press("down"); // More like this
  await app.keyboard.press("enter");
  await app.keyboard.press("escape");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("a person without a photo shows their initials; a click on a similar title opens it", async () => {
  const app = await open("./App.tsx", { platform: "macos", width: 1440, height: 900, modules: { "app/native": NATIVE } });
  await app.press("label:Inception >> nth=0");
  expect(app.texts()).toContain("JG");
  await app.press("label:Dune >> nth=0");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("More like this");
});
