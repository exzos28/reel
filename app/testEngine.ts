// Stand-ins for the native core in headless tests (`open`'s `modules`):
// the engine, and the catalog as the core answers it from the metadata
// layer (no network). A stand-in answers every call the same, so each
// test picks the title and the episodes its screen shows.

/** Engine calls every test needs: a film opens as job 1 and there is room. */
export const ENGINE = {
  "Engine.open": 1,
  "Engine.close": null,
  "Engine.checkSpace": JSON.stringify({ ok: true, free: 10 * 1024 ** 3, needed: 306 * 1024 ** 2, buffer: 256 }),
  "Engine.timeline": JSON.stringify({ ranges: [], ahead: 0 }),
  /** The sources About names, as the core lists them. */
  "Meta.attribution": JSON.stringify([
    { provider: "tmdb", name: "TMDB", url: "https://www.themoviedb.org", logoRequired: true, license: null,
      notice: "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB." },
    { provider: "anilist", name: "AniList", url: "https://anilist.co", notice: null, logoRequired: false, license: null },
    { provider: "jikan", name: "Jikan (MyAnimeList)", url: "https://jikan.moe", notice: null, logoRequired: false, license: null },
    { provider: "animeLists", name: "Fribb/anime-lists", url: "https://github.com/Fribb/anime-lists", notice: null, logoRequired: false, license: null },
  ]),
};

const img = (size: string, name: string) => `https://image.tmdb.org/t/p/${size}/${name}.jpg`;

function summary(over: Record<string, unknown>) {
  const id = over.id as string;
  const rating = (over.rating as string) ?? "7.5";
  const votes = (over.votes as string) ?? "10K";
  return {
    kind: "movie", about: "", notice: null, anime: false, year: 2010, yearEnd: null, minutes: 0,
    rating, votes, ratings: [{ source: "tmdb", value: rating, votes }], certification: null, badges: [], genres: [],
    still: img("w1280", id), card: img("w780", id), poster: img("w342", id),
    ink: "#F5F5F5", paper: "#1A1A1A", stoppedAt: null, progress: 0, left: null, resume: null,
    seasons: 0, airs: null, tag: null, playable: true, inList: false, release: null,
    play: { id, start: 0 },
    ...over,
  };
}

/** A film the viewer stopped 41:12 into, with a release found on their source. */
export const INCEPTION = summary({
  id: "tmdb:movie:27205", title: "Inception", year: 2010, minutes: 148, rating: "8.4", votes: "38K",
  genres: ["Action", "Science Fiction"], about: "A thief who steals secrets through dreams is offered a way home.",
  stoppedAt: 2472, progress: 0.28, left: 107, play: { id: "tmdb:movie:27205", start: 2472 },
  release: { quality: "1080p", source: "BluRay", pack: false, size: "8 GB", peers: 412, fast: true },
});

/** A show the viewer is in, at S3:E2. */
export const AOT = summary({
  id: "tmdb:tv:1429", kind: "show", title: "Attack on Titan", year: 2013, yearEnd: 2023, rating: "8.7", votes: "7.1K",
  genres: ["Animation", "Action & Adventure"], anime: true, seasons: 4, progress: 0.4, left: 14,
  resume: { season: 3, episode: 2 }, play: { id: "tmdb:tv:1429:s3e2", season: 3, episode: 2, start: 600 },
});

const ARRIVAL = summary({ id: "tmdb:movie:329865", title: "Arrival", year: 2016, minutes: 116, rating: "7.6" });
const DUNE = summary({ id: "tmdb:movie:438631", title: "Dune", year: 2021, minutes: 155, rating: "7.8" });
const SEVERANCE = summary({ id: "tmdb:tv:95396", kind: "show", title: "Severance", year: 2022, seasons: 2 });
const FRIEREN = summary({ id: "anilist:154587", kind: "show", title: "Frieren: Beyond Journey's End", anime: true, year: 2023 });

export const HOME = [
  { id: "continue", items: [INCEPTION, AOT] },
  { id: "trending_movies", items: [DUNE, ARRIVAL, INCEPTION] },
  { id: "trending_shows", items: [SEVERANCE, AOT] },
  { id: "popular", items: [ARRIVAL, SEVERANCE] },
  { id: "anime", items: [FRIEREN, AOT] },
];

export const release = (index: number, quality: string, source: string, group: string, size: string, peers: number, bars: number, note: string, mbit: number, selected = false) => ({
  index, quality, source, group, size, tracks: [], peers, bars, note, mbit, selected, pack: false, indexer: "test", top: true,
});

/** What a title screen shows below the hero (a film's). */
const BELOW = {
  aboutFull: true,
  cast: [
    { name: "Leonardo DiCaprio", character: "Cobb", photo: img("w185", "dicaprio"), initials: "LD" },
    { name: "Joseph Gordon-Levitt", character: "Arthur", photo: null, initials: "JG" },
    { name: "Elliot Page", character: "Ariadne", photo: img("w185", "page"), initials: "EP" },
  ],
  crew: [
    { job: "director", names: ["Christopher Nolan"] },
    { job: "music", names: ["Hans Zimmer"] },
  ],
  tagline: "Your mind is the scene of the crime.",
  originalTitle: null,
  releaseDate: [2010, 7, 15],
  countries: ["United Kingdom", "United States"],
  studios: ["Legendary Pictures", "Syncopy"],
  status: null,
  trailer: null,
};

/** Inception's screen: three releases from the user's source, fastest first. */
export const INCEPTION_TITLE = {
  ...INCEPTION,
  ...BELOW,
  certification: "PG-13",
  similar: [DUNE, ARRIVAL],
  releasesState: "done",
  releases: [
    release(2, "4K", "Remux", "Inception.2010.2160p.UHD.BluRay.REMUX", "60 GB", 38, 3, "needs", 58),
    release(0, "1080p", "BluRay", "Inception.2010.1080p.BluRay.x264", "8 GB", 412, 4, "starts_fast", 8, true),
    release(1, "720p", "WEB", "Inception.2010.720p.WEB", "2 GB", 655, 4, "starts_fast", 2),
  ],
};

/** The same screen without a search source in Settings. */
export const INCEPTION_NO_SOURCE = { ...INCEPTION_TITLE, release: null, playable: false, releases: [], releasesState: "no_source" };

export const AOT_TITLE = {
  ...AOT,
  ...BELOW,
  aboutFull: false,
  crew: [{ job: "creator", names: ["Hajime Isayama"] }],
  cast: [{ name: "Yuki Kaji", character: "Eren Yeager (voice)", photo: null, initials: "YK" }],
  tagline: null,
  releaseDate: [2013, 4, 7],
  countries: ["Japan"],
  studios: ["MBS"],
  status: "ended",
  trailer: null,
  certification: "TV-MA",
  ratings: [
    { source: "tmdb", value: "8.7", votes: "7.1K" },
    { source: "anilist", value: "84%", votes: "" },
    { source: "mal", value: "8.54", votes: "2.4M" },
  ],
  similar: [FRIEREN],
  releasesState: "searching",
  releases: [],
  season: 3,
  seasonList: [
    { number: 1, year: 2013, episodes: 25, name: "Season 1" },
    { number: 2, year: 2017, episodes: 12, name: "Season 2" },
    { number: 3, year: 2018, episodes: 22, name: "Season 3" },
    { number: 4, year: 2020, episodes: 28, name: "The Final Season" },
  ],
};

/** Season 3 aired weekly from July 23, 2018. */
function airDate(n: number) {
  const d = new Date(Date.UTC(2018, 6, 16 + 7 * n));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function episode(n: number, title: string, over: Record<string, unknown> = {}) {
  return {
    id: `tmdb:tv:1429:s3e${n}`, show: "tmdb:tv:1429", season: 3, number: n, title, about: `${title}, the episode.`,
    minutes: 24, date: airDate(n), rating: "8.5", thumb: null, progress: 0, left: null, watched: false,
    start: 0, quality: null, playable: true, ...over,
  };
}

export const AOT_S3 = [
  episode(1, "Smoke Signal", { progress: 1, watched: true }),
  episode(2, "Pain", { progress: 0.4, left: 14, start: 600 }),
  episode(3, "Old Story"),
  episode(4, "Trust"),
];

/** The catalog as most tests see it: Home, Browse, Inception's screen. */
export const CATALOG = {
  "Catalog.revision": 1,
  "Catalog.home": JSON.stringify(HOME),
  "Catalog.browse": JSON.stringify({ trending: [DUNE, ARRIVAL, INCEPTION], all: [ARRIVAL, DUNE, INCEPTION, SEVERANCE] }),
  "Catalog.title": JSON.stringify(INCEPTION_TITLE),
  "Catalog.episodes": JSON.stringify(AOT_S3),
  "Catalog.episode": JSON.stringify(AOT_S3[1]),
  "Catalog.upNext": "null",
  "Catalog.tracks": JSON.stringify({
    audio: [{ key: "original", selected: true }],
    subtitles: [{ key: "off", selected: true }],
    releases: INCEPTION_TITLE.releases,
  }),
  "Catalog.toggleList": true,
  "Catalog.chooseRelease": true,
  "Catalog.startAt": 0,
  "Catalog.saveProgress": false,
};

/** Attack on Titan's screen instead of Inception's. */
export const SHOW = { ...CATALOG, "Catalog.title": JSON.stringify(AOT_TITLE) };

/** The video view that plays its first frame at once (a headless `<Video>`
 * never loads): for tests of the player once the film plays. */
export const STILL = { "VideoEngine.kind": "still" };

/** Engine and catalog: what most tests run on. */
export const NATIVE = { ...ENGINE, ...CATALOG };
