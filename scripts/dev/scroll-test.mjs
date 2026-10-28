// Regression test for trackpad scrolling in the list and reader panes.
// Runs in the Playwright container (see screenshots.mjs for the docker command).
import { chromium } from "playwright";

const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 420 } });
await page.goto(url);
await page.waitForSelector(".row");

async function wheelScrolls(selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
  const before = await page.$eval(selector, (el) => ({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }));
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const after = await page.$eval(selector, (el) => el.scrollTop);
  return { ...before, after, scrolled: after > before.top };
}

const list = await wheelScrolls(".list");
await page.click(".row >> nth=0");
await page.waitForSelector(".msg-body");
await page.waitForTimeout(600);
const reader = await wheelScrolls(".reader-body");
const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
console.log(JSON.stringify({ list, reader, viewport: 420, pageHeight }));
await browser.close();
process.exit(list.scrolled && reader.scrolled ? 0 : 1);
