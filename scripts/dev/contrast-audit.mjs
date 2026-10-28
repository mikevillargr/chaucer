// Colour-contrast audit (axe-core, WCAG AA) of the mock preview in light and dark mode, plus
// a drag test of the pane divider. Run in the Playwright container:
//   node contrast-audit.mjs http://host:3010 /out/dir   (needs playwright + @axe-core/playwright)
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch();
let failures = 0;

// Email frames are sandboxed without scripts; axe can stall on them once other UI is layered
// on top, so later checks exclude them (their contents are audited in the reader step).
async function audit(page, label, { frames = true } = {}) {
  let builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (!frames) builder = builder.exclude("iframe");
  const res = await Promise.race([
    builder.analyze(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: audit timed out`)), 60000)),
  ]);
  const nodes = res.violations.flatMap((v) => v.nodes);
  failures += nodes.length;
  console.log(`${label}: ${nodes.length ? nodes.length + " contrast issue(s)" : "ok"}`);
  for (const n of nodes.slice(0, 8)) console.log("   -", n.target.join(" "), "|", n.any[0]?.message);
}

for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(url);
  await page.waitForSelector(".row");
  await page.waitForTimeout(400);
  await audit(page, `${scheme} inbox`);

  for (const [tab, subject] of [["Primary", "Notes from Tuesday"], ["Updates", "This week in search"]]) {
    await page.click(`.tab:has-text("${tab}")`);
    await page.click(`.row:has-text("${subject}")`);
    await page.waitForSelector(".msg-body iframe, .msg-body .plain");
    await page.waitForTimeout(700);
    await audit(page, `${scheme} reader: ${subject}`);
    await page.screenshot({ path: `${out}/${scheme}-${subject.split(" ")[0].toLowerCase()}.png` });
  }

  await page.click("text=Reply >> nth=-1");
  await page.waitForSelector(".compose .tiptap");
  await page.waitForTimeout(300);
  await audit(page, `${scheme} compose`, { frames: false });
  await page.keyboard.press("Escape");

  await page.click("[aria-label^='Settings']");
  await page.waitForTimeout(300);
  await audit(page, `${scheme} settings`, { frames: false });
  await page.click("text=Back to mail");

  if (scheme === "light") {
    const sep = page.locator('[aria-label="Resize conversation list"]');
    const box = await sep.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 124, box.y + 300, { steps: 6 });
    await page.mouse.up();
    const w = await page.$eval(".list-pane", (el) => el.getBoundingClientRect().width);
    console.log(`drag list divider +120px -> list width ${Math.round(w)}px`);
    await page.screenshot({ path: `${out}/light-resized.png` });
  }
  await context.close();
}

console.log(failures ? `TOTAL contrast issues: ${failures}` : "no contrast issues");
await browser.close();
process.exit(failures ? 1 : 0);
