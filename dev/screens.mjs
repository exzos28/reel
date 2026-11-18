// Screenshots of the web build in headless Chrome, driven over the DevTools protocol (no
// dependencies: Node's own WebSocket). dev/screens.sh builds the UI, starts the core standing in for
// each target and runs this once per target, then once more for the index; see there.
//
//   node dev/screens.mjs shoot <ui url> <out dir> <target> [sizes] [screens]
//   node dev/screens.mjs index <out dir>
//
// sizes and screens: comma-separated names (empty: all of the target's, dev/screens/matrix.json).
// The pictures: <out>/<target>/<size>-<screen>.png; the index: <out>/index.html.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MATRIX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "screens", "matrix.json"), "utf8"));
/** Pixels per point: a Retina screen's (a TV's: 1, it is 1920 pixels wide). */
const SCALE = { tv: 1 };
/** How long the network must be quiet before a picture, ms, and the longest a step waits for it. */
const QUIET = 700;
const MOST = 10000;
/** The requests a picture waits for (DevTools' resource types). */
const WAITED = new Set(["Document", "Stylesheet", "Image", "Media", "Font", "Script"]);

const [mode, ...rest] = process.argv.slice(2);
if (mode === "index") {
  writeIndex(rest[0]);
  process.exit(0);
}
if (mode !== "shoot" || rest.length < 3) {
  console.error("usage: node dev/screens.mjs shoot <ui url> <out dir> <target> [sizes] [screens] | index <out dir>");
  process.exit(2);
}
const [url, out, target, sizeList = "", screenList = ""] = rest;
const spec = MATRIX.targets[target];
if (!spec) fail(`no target "${target}" (${Object.keys(MATRIX.targets).join(", ")})`);
const pick = (list, all, what) => {
  const names = list.split(",").filter(Boolean);
  const unknown = names.filter((n) => !all.includes(n));
  if (unknown.length) fail(`${target}: no ${what} ${unknown.join(", ")} (${all.join(", ")})`);
  return names.length ? all.filter((n) => names.includes(n)) : all;
};
const sizes = pick(sizeList, spec.sizes.map((s) => s[0]), "size").map((n) => spec.sizes.find((s) => s[0] === n));
const screens = pick(screenList, MATRIX.screens, "screen");
mkdirSync(join(out, target), { recursive: true });

function fail(message) {
  console.error(`screens: ${message}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "reel-screens-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], {
  stdio: ["ignore", "ignore", "pipe"],
});
process.on("exit", () => {
  chrome.kill();
  // Chrome may still be writing its profile as it quits.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});

/** The DevTools address Chrome prints on stderr. */
const devtools = await new Promise((resolve, reject) => {
  let text = "";
  chrome.stderr.on("data", (d) => {
    text += d;
    const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}): ${text}`)));
});

/** A DevTools session on a new page; `inflight` counts its network requests not finished yet. */
async function session() {
  const browser = new WebSocket(devtools);
  await new Promise((r) => browser.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  const net = { inflight: new Set(), last: Date.now() };
  browser.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      return;
    }
    // What a picture waits for: pictures, fonts, scripts. Not the UI's calls to the core, some of
    // which come once a second for as long as a screen is up (the network is never quiet).
    if (m.method === "Network.requestWillBeSent") {
      if (!WAITED.has(m.params.type)) return;
      net.inflight.add(m.params.requestId);
    }
    else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") net.inflight.delete(m.params.requestId);
    else return;
    net.last = Date.now();
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, { resolve, reject });
      browser.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Network.enable");
  return { page, net, close: () => browser.close() };
}

const { page, net, close } = await session();

/** Evaluates `js` in the page and returns its value. */
async function evaluate(js) {
  const r = await page("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** Waits until no request has been open for `QUIET` ms (the core's answers, TMDB's pictures),
 * `MOST` ms at most, and the page drew a frame after it. */
async function settle() {
  const end = Date.now() + MOST;
  await sleep(150);
  while (Date.now() < end && (net.inflight.size > 0 || Date.now() - net.last < QUIET)) await sleep(100);
  await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
}

const labelled = (label) => JSON.stringify(`[aria-label="${label}"]`);

/** Waits until an element labelled one of `labels` is on the page; returns the label found. */
async function waitFor(labels, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const label of labels) if (await evaluate(`!!document.querySelector(${labelled(label)})`)) return label;
    await sleep(250);
  }
  throw new Error(`nothing labelled ${labels.map((l) => `"${l}"`).join(" or ")} after ${timeout} ms`);
}

/** Clicks the element labelled `label` (the first of `labels` on the page) as a pointer does:
 * NSH's web views hear pointer events, not a bare `click()`. A touch target taps it. */
async function click(...labels) {
  const label = await waitFor(labels);
  const at = await evaluate(
    `(() => {
      const e = document.querySelector(${labelled(label)});
      e.scrollIntoView({ block: "center", inline: "center" }); // a page may come back scrolled
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await sleep(250);
  if (spec.touch) {
    const point = [{ x: at.x, y: at.y }];
    await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
    await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await page("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
  }
  await settle();
}

/** Scrolls the page's scroll view (the tallest scrollable element) by `dy` points. */
async function scrollBy(dy) {
  await evaluate(
    `(() => {
      const all = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 10 && getComputedStyle(e).overflowY !== "visible");
      const view = all.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (view) view.scrollTop += ${dy};
    })()`,
  );
  await settle();
}

/** How each screen is reached from a fresh Home, and what is then on it. */
const STEPS = {
  home: async () => {},
  shelves: async (h) => scrollBy(Math.round(h * 0.6)),
  // Sintel (Continue watching, dev/screens/state): a free film's page; the hero's title else.
  title: async () => click("Sintel", "Details"),
  movies: async () => click("Movies"),
  search: async () => click("Search"),
  settings: async () => click("Settings"),
};

let current = "";
try {
  for (const [name, width, height] of sizes) {
    console.log(`${target} ${name} ${width}x${height}`);
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE[target] ?? 2, mobile: spec.touch });
    await page("Emulation.setTouchEmulationEnabled", { enabled: spec.touch, maxTouchPoints: spec.touch ? 5 : 1 });
    for (const screen of screens) {
      current = `${name}-${screen}`;
      // Each screen from a freshly loaded Home: one screen's state never leaks into the next.
      await page("Page.navigate", { url });
      await waitFor(["Details"]); // Home's hero has its title
      await settle();
      await STEPS[screen](height);
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, target, `${current}.png`), Buffer.from(data, "base64"));
      console.log(`  ${target}/${current}.png`);
    }
  }
} catch (e) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, target, `${current}-failed.png`), Buffer.from(data, "base64"));
  console.error(`screens: ${target} ${current} failed; the page as it was: ${join(out, target, `${current}-failed.png`)}`);
  console.error(`  on the page: ${(await evaluate("document.body.innerText.slice(0, 300)").catch(() => "")).replace(/\s+/g, " ")}`);
  console.error(e.message);
  process.exit(1);
}
close();
process.exit(0);

/** <out>/index.html: per target a table of its sizes (rows) by screen (columns), each picture a link
 * to itself at full size; the targets one after another, linked from the top. */
function writeIndex(dir) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const targets = Object.keys(MATRIX.targets).filter((t) => existsSync(join(dir, t)));
  const sections = targets.map((t) => {
    const files = new Set(readdirSync(join(dir, t)));
    const rows = MATRIX.targets[t].sizes
      .filter(([n]) => MATRIX.screens.some((s) => files.has(`${n}-${s}.png`)))
      .map(([n, w, h]) => {
        const cells = MATRIX.screens.map((s) => {
          const f = `${n}-${s}.png`;
          const failed = `${n}-${s}-failed.png`;
          if (files.has(f)) return `<td><a href="${t}/${f}" target="_blank"><img loading="lazy" src="${t}/${f}" alt="${esc(`${t} ${n} ${s}`)}"></a></td>`;
          if (files.has(failed)) return `<td class="failed"><a href="${t}/${failed}" target="_blank"><img loading="lazy" src="${t}/${failed}" alt="failed"></a><span>failed</span></td>`;
          return "<td class=\"none\">—</td>";
        });
        return `<tr><th>${esc(n)}<small>${w} × ${h} · ${(w / h).toFixed(2)}</small></th>${cells.join("")}</tr>`;
      });
    return `<section id="${t}"><h2>${esc(t)}</h2><div class="scroll"><table><thead><tr><th></th>${MATRIX.screens.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></section>`;
  });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>reel screens</title><style>
:root { color-scheme: dark; --bg: #0e0e10; --fg: #ececf0; --dim: #8a8a96; --line: #26262c; --bad: #ff5a5a; }
body { margin: 0; padding: 16px 24px 48px; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, system-ui, sans-serif; }
header { position: sticky; top: 0; background: var(--bg); padding: 8px 0 12px; border-bottom: 1px solid var(--line); z-index: 1; }
header a { color: var(--fg); margin-right: 14px; text-decoration: none; } header a:hover { text-decoration: underline; }
h1 { font-size: 18px; margin: 0 0 6px; } h2 { font-size: 16px; margin: 28px 0 10px; }
.scroll { overflow-x: auto; } table { border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 6px; vertical-align: top; text-align: left; }
thead th { color: var(--dim); font-weight: 500; } tbody th { white-space: nowrap; font-weight: 600; }
th small { display: block; color: var(--dim); font-weight: 400; }
td img { display: block; width: 320px; height: auto; } td.none { color: var(--dim); text-align: center; }
td.failed { outline: 2px solid var(--bad); } td.failed span { color: var(--bad); }
</style></head><body><header><h1>reel screens</h1>${targets.map((t) => `<a href="#${t}">${esc(t)}</a>`).join("")}<span style="color:var(--dim)">${esc(new Date().toISOString().slice(0, 16).replace("T", " "))}</span></header>
${sections.join("\n")}</body></html>`;
  writeFileSync(join(dir, "index.html"), html);
  console.log(`screens: ${join(dir, "index.html")}`);
}
