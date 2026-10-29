// Trackpad swipe on thread rows against the mock preview (Playwright container).
// Chromium sends wheel deltas as "natural" (finger direction = -deltaX), like a Mac trackpad.
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);
const results = {};
await page.goto(url);
await page.waitForSelector(".row");

const rows = () => page.$$eval(".row", (r) => r.length);
const transform = () => page.$eval(".row >> nth=0", (el) => el.style.transform).catch(() => "");
const box = await (await page.$(".row")).boundingBox();
const burst = async (dx, dy, n) => {
  await page.mouse.move(box.x + 200, box.y + box.height / 2);
  for (let i = 0; i < n; i++) { await page.mouse.wheel(dx, dy); await page.waitForTimeout(16); }
};
const before = await rows();

// 1. Short swipe: follows the fingers, then springs back without acting.
await burst(-20, 0, 2);
results.shortSwipeMoves = (await transform()).startsWith("translateX(");
await page.waitForTimeout(500);
results.shortSwipeSpringsBack = (await transform()) === "" && (await rows()) === before;

// 2. Vertical scroll is left alone.
await burst(0, 60, 3);
results.verticalIgnored = (await transform()) === "";
await page.waitForTimeout(300);

// 3. Long swipe right: arms the strip, commits on release, archives the conversation, offers Undo.
await burst(-40, 0, 4);
results.armed = await page.$eval(".swipe", (el) => el.dataset.armed === "true" && el.dataset.dir === "right");
await page.screenshot({ path: `${out}/swipe-armed.png` });
await page.waitForTimeout(800);
results.archived = (await rows()) === before - 1;
results.toast = await page.$eval(".toasts", (el) => el.textContent.includes("Archived")).catch(() => false);

// 4. Left swipe uses its own setting (default archive too).
await burst(40, 0, 4);
await page.waitForTimeout(800);
results.leftArchived = (await rows()) === before - 2;

console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
