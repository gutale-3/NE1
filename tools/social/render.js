// Renders the pack's HTML slides to JPG: node render.js <folder> name:WxH ...
const path = require('path');
let playwright;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { playwright = require(p); break; } catch (e) { /* try the next */ }
}
if (!playwright) throw new Error('Playwright is not installed');

(async () => {
  const [folder, ...specs] = process.argv.slice(2);
  const launch = {};
  if (require('fs').existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
  const browser = await playwright.chromium.launch(launch);
  for (const spec of specs) {
    const [name, size] = spec.split(':');
    const [width, height] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('file://' + path.resolve(folder, name + '.html'));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.resolve(folder, name + '.jpg'), type: 'jpeg', quality: 88 });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
