// Screenshots of the web build (a desktop browser's layout) in windows of several sizes and ratios,
// in headless Chrome driven over the DevTools protocol (no dependencies: Node's own WebSocket).
// dev/screens.sh builds the UI, starts the core and runs this; see there.
//
//   node dev/screens.mjs <ui url> <out dir> [size filter]
//
// Each size: Home (its top, then scrolled to its shelves), Movies, a title's page (Home's Details).
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Window sizes, CSS points: [name, width, height]. The ratio decides the content column
 * (app/ui/layout/chrome.ts, contentWidthFor: wider than 2.2 of its height is ultra-wide). */
const SIZES = [
  ["macbook-14", 1512, 945], // 16:10, a 14" MacBook's default
  ["fhd", 1920, 1080], // 16:9
  ["qhd", 2560, 1440], // 16:9, a 27" display
  ["qhd-short", 2560, 1208], // 2.12, under the ultra-wide ratio
  ["wide-2.26", 3008, 1329], // just over the ultra-wide ratio
  ["uw-21x9", 3440, 1440], // 21:9
  ["short-wide", 2560, 900], // 2.84, a short wide window
  ["uw-32x9", 5120, 1440], // 32:9
];
/** Pixels per point: a Retina screen's. */
const SCALE = 2;
/** Time for TMDB's pictures to arrive and draw after a step, ms. */
const SETTLE = 3000;

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [url, out, filter] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node dev/screens.mjs <ui url> <out dir> [size filter]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const sizes = SIZES.filter(([name]) => !filter || name.includes(filter));
if (!sizes.length) {
  console.error(`screens: no size matches "${filter}" (${SIZES.map((s) => s[0]).join(", ")})`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "reel-screens-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], {
  stdio: ["ignore", "ignore", "pipe"],
});
const cleanup = () => {
  chrome.kill();
  // Chrome may still be writing its profile as it quits.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
};
process.on("exit", cleanup);

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

/** A DevTools session on a new page. */
async function session() {
  const browser = new WebSocket(devtools);
  await new Promise((r) => browser.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  browser.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
    }
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
  return { page, close: () => browser.close() };
}

/** Evaluates `js` in the page and returns its value. */
async function evaluate(page, js) {
  const r = await page("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** Waits until an element labelled `label` is on the page, `timeout` ms at most. */
async function waitFor(page, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(page, `!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`)) return;
    await sleep(250);
  }
  throw new Error(`nothing labelled "${label}" after ${timeout} ms`);
}

/** Clicks the element labelled `label` as a mouse does (NSH's web views listen to pointer events,
 * not to a bare `click()`): moves to its middle, presses and lets go. */
async function click(page, label) {
  await waitFor(page, label);
  const at = await evaluate(
    page,
    `(() => {
      const e = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
      e.scrollIntoView({ block: "center", inline: "center" }); // a page may come back scrolled (Home)
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await sleep(300);
  await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
}

/** Scrolls the page's scroll view (the tallest scrollable element) by `dy` points. */
const scrollBy = (page, dy) =>
  evaluate(
    page,
    `(() => {
      const all = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 10 && getComputedStyle(e).overflowY !== "visible");
      const view = all.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (view) view.scrollTop += ${dy};
      return !!view;
    })()`,
  );

async function shot(page, file) {
  await sleep(SETTLE);
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, file), Buffer.from(data, "base64"));
  console.log(`  ${file}`);
}

const { page, close } = await session();
/** On a failure, what the page showed: out/<size>-failed.png. */
let current = "";
try {
  for (const [name, width, height] of sizes) {
    current = name;
    console.log(`${name} ${width}x${height}`);
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: false });
    await page("Page.navigate", { url });
    await waitFor(page, "Details"); // Home's hero has its title
    await shot(page, `${name}-home.png`);
    await scrollBy(page, Math.round(height * 0.6));
    await shot(page, `${name}-home-shelves.png`);
    await click(page, "Movies");
    await shot(page, `${name}-movies.png`);
    await click(page, "Home");
    await click(page, "Details");
    await shot(page, `${name}-title.png`);
  }
} catch (e) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${current}-failed.png`), Buffer.from(data, "base64"));
  console.error(`screens: ${current} failed; the page as it was: ${join(out, `${current}-failed.png`)}`);
  console.error(`  ${await evaluate(page, "document.body.innerText.slice(0, 400)").catch(() => "")}`);
  throw e;
}
close();
console.log(`screens: ${out}`);
process.exit(0);
