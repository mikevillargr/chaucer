// End-to-end check of @/+ mentions in compose against the mock preview (Playwright container).
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15000);
const results = {};
await page.goto(url);
await page.waitForSelector(".row");
await page.click(".compose-fab");
await page.waitForSelector(".compose .tiptap");
await page.click(".compose .tiptap");

await page.keyboard.type("Hi @ana");
await page.waitForSelector(".mention-menu");
results.menuShowsAna = await page.$eval(".mention-menu", (el) => el.textContent.includes("Ana Reyes"));
await page.screenshot({ path: `${out}/mention-menu.png` });
await page.keyboard.press("Enter");
results.mentionInserted = await page.$eval(".compose .tiptap", (el) => el.querySelector("a.mention")?.textContent);
results.toAfterAt = await page.$$eval(".compose .recip", (els) => els.map((e) => e.textContent.trim()));

await page.keyboard.type("and +priya");
await page.waitForSelector(".mention-menu");
await page.keyboard.press("Enter");
results.toAfterPlus = await page.$$eval(".compose .recip", (els) => els.map((e) => e.textContent.trim()));

await page.keyboard.type(" cc @sam");
await page.waitForSelector(".mention-menu");
await page.keyboard.press("Escape");
results.escapeKeepsCompose = (await page.$(".compose")) !== null;
results.menuClosedOnEscape = (await page.$(".mention-menu")) === null;

await page.keyboard.type(" mail me@example.com");
await page.waitForTimeout(400);
results.emailDoesNotTrigger = (await page.$(".mention-menu")) === null;
await page.screenshot({ path: `${out}/mention-compose.png` });

console.log(JSON.stringify(results, null, 1));
const ok = results.menuShowsAna && results.mentionInserted === "@Ana Reyes" &&
  results.toAfterAt.some((t) => t.startsWith("Ana Reyes")) && results.toAfterPlus.some((t) => t.startsWith("Priya Shah")) &&
  results.escapeKeepsCompose && results.menuClosedOnEscape && results.emailDoesNotTrigger;
console.log(ok ? "MENTIONS OK" : "MENTIONS FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
