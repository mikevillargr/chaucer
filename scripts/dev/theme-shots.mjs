// Screenshots of each skin theme (kinetic, terminal-green, terminal-white) against the mock preview:
//   docker run --rm -v "$PWD:/app" -w /tmp mcr.microsoft.com/playwright:v1.56.0-noble \
//     sh -c "npm i -s playwright@1.56.0 >/dev/null && node /app/scripts/dev/theme-shots.mjs http://host:3010 /app/.shots"
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const errors = [];
for (const theme of ["kinetic", "terminal-green", "terminal-white"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(`${theme}: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector(".row");
  await page.click("[aria-label^='Settings']");
  await page.selectOption("select[aria-label='Theme']", theme);
  console.log(theme, await page.evaluate(() => `${document.documentElement.dataset.theme}/${document.documentElement.dataset.family}`));
  await page.screenshot({ path: `${out}/${theme}-settings.png` });
  await page.click("text=Back to mail");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${theme}-inbox.png` });
  await page.click(".row >> nth=0");
  await page.waitForSelector(".msg-body");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${theme}-reader.png` });
  await page.click("text=Reply >> nth=-1");
  await page.waitForSelector(".compose .tiptap");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${theme}-compose.png` });
  await page.close();
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
