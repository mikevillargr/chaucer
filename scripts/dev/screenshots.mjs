// Screenshots of the mock-backed preview, run inside the Playwright container:
//   docker run --rm -v "$PWD:/app" -w /tmp mcr.microsoft.com/playwright:v1.56.0-noble \
//     sh -c "npm i -s playwright@1.56.0 >/dev/null && node /app/scripts/dev/screenshots.mjs http://host:3010 /app/.shots"
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url);
await page.waitForSelector(".row");
console.log("unread row weight:", await page.$eval(".row.unread .from", (el) => getComputedStyle(el).fontWeight).catch(() => "no .row.unread"));
await page.screenshot({ path: `${out}/1-inbox.png` });

await page.click(".row >> nth=0");
await page.waitForSelector(".msg-body");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/2-reader.png` });

await page.click("text=Reply >> nth=-1");
await page.waitForSelector(".compose .tiptap");
await page.keyboard.type("Thanks Ana, will do.");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-compose.png` });
await page.keyboard.press("Escape");

await page.click("[aria-label^='Settings']");
await page.click("text=Smart features");
await page.screenshot({ path: `${out}/4-settings.png` });
await page.click("text=General");
await page.selectOption("select[aria-label='Theme']", "dark");
await page.click("text=Back to mail");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/5-dark.png` });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
