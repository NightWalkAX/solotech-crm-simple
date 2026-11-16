// Screenshot CRM pages for review: node scripts/shot.js <outDir> [path ...]
import { chromium } from 'playwright';
const [out = '.', ...paths] = process.argv.slice(2);
const BASE = process.env.CRM_WEB_URL || 'http://127.0.0.1:4000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const p of paths.length ? paths : ['/']) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const name = p.replace(/\W+/g, '_') || 'root';
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
await browser.close();
