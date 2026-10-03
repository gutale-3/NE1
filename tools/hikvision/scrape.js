// Fetch Hikvision product pages for the catalogue (see tools/import-hikvision.py).
//
//   node tools/hikvision/scrape.js sitemap   # save hikvision.com's sitemap
//   python3 tools/hikvision/make-plan.py     # match models to pages
//   node tools/hikvision/scrape.js           # fetch the pages into cache/
//
// hikvision.com serves a JavaScript bot check, so this drives a real browser.
// It caches every page by URL and waits between requests (robots.txt asks for
// a 1 s crawl delay). Needs Playwright; set PLAYWRIGHT_MODULE if it is not
// resolvable from here.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const HERE = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = u => path.join(HERE, 'cache', crypto.createHash('md5').update(u).digest('hex') + '.json');

function extract() {
  const q = (s, r = document) => [...r.querySelectorAll(s)];
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const wrap = document.querySelector('.product_description-wrapper');
  const html = document.documentElement.outerHTML;
  const subs = q('.product_description_sub_item .content').map(e => ({ id: e.dataset.value, name: clean(e.dataset.name) }));
  const specs = {};
  q('.content-detail-section').forEach(sec => {
    const id = sec.dataset.subModel;
    if (!id || specs[id]) return;
    const w = sec.querySelector('.tech-specs-items-wrap'); if (!w) return;
    specs[id] = q('ul.tech-specs-items-description', w).map(ul => ({
      group: clean((ul.querySelector('.tech-specs-items-description__title--heading') || {}).textContent) || clean(ul.dataset.target),
      rows: q('li', ul).filter(li => li.querySelector('.tech-specs-items-description__title')).map(li => [
        clean(li.querySelector('.tech-specs-items-description__title').textContent),
        clean((li.querySelector('.tech-specs-items-description__title-details') || {}).textContent)])
    })).filter(g => g.rows.length);
  });
  // single-product pages may not have sections with subModel
  if (!Object.keys(specs).length) {
    const w = document.querySelector('.tech-specs-items-wrap');
    if (w) specs['_single'] = q('ul.tech-specs-items-description', w).map(ul => ({
      group: clean((ul.querySelector('.tech-specs-items-description__title--heading') || {}).textContent) || clean(ul.dataset.target),
      rows: q('li', ul).filter(li => li.querySelector('.tech-specs-items-description__title')).map(li => [
        clean(li.querySelector('.tech-specs-items-description__title').textContent),
        clean((li.querySelector('.tech-specs-items-description__title-details') || {}).textContent)])
    })).filter(g => g.rows.length);
  }
  const imgRe = /https:\/\/assets\.hikvision\.com\/prd\/(?:normal|public)\/all\/image\/(s?m\d+)\/(?:[a-z0-9_]+\/)?[^"'?)\s\/]+?\.(?:png|jpe?g)(?=["'?)\s])/gi;
  const images = [...new Set([...html.matchAll(imgRe)].map(m => m[0]).filter(u => !/\.thumb\.|\.original\./.test(u)))];
  const docs = [...new Set([...html.matchAll(/https:\/\/assets\.hikvision\.com\/prd\/(?:normal|public)\/all\/doc\/(s?m\d+)\/[^"'?)\s]+?\.pdf/gi)].map(m => m[0]))];
  return {
    title: clean((document.querySelector('.product_description_title') || {}).textContent),
    h1: clean((document.querySelector('h1') || {}).textContent),
    family: wrap ? wrap.dataset.productNumber : null,
    features: q('.product_description_item').map(e => clean(e.textContent)).filter(Boolean),
    subs, specs, images, docs,
  };
}

(async () => {
  fs.mkdirSync(path.join(HERE, 'cache'), { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY }, args: ['--ignore-certificate-errors'] });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', locale: 'en-US' });
  const pg = await ctx.newPage();
  if (process.argv[2] === 'sitemap') {
    let body = '';
    pg.on('response', async r => { try { const t = await r.text(); if (t.includes('<urlset')) body = t; } catch {} });
    await pg.goto('https://www.hikvision.com/en/sitemap.xml', { waitUntil: 'networkidle', timeout: 90000 });
    await sleep(5000);
    if (!body) throw new Error('sitemap not received');
    fs.writeFileSync(path.join(HERE, 'sitemap.xml'), body);
    console.log('sitemap saved');
    return b.close();
  }
  const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json')));
  await pg.route('**/*', r => ['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  const urls = [...new Set(plan.flatMap(p => p.urls))];
  let n = 0;
  for (const u of urls) {
    n++;
    // Re-fetch pages saved before their specs or photos had rendered.
    if (fs.existsSync(key(u))) {
      const prev = JSON.parse(fs.readFileSync(key(u)));
      if (Object.keys(prev.specs).length && prev.images.length) continue;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await pg.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await pg.waitForSelector('.product_description-wrapper, .tech-specs-items-wrap', { timeout: 30000 });
        await pg.waitForSelector('.tech-specs-items-description__title', { timeout: 20000 }).catch(() => {});
        await pg.waitForFunction(() => document.documentElement.outerHTML.includes('/all/image/'), null, { timeout: 20000 }).catch(() => {});
        await sleep(1500);
        const data = await pg.evaluate(extract);
        data.url = u;
        fs.writeFileSync(key(u), JSON.stringify(data));
        console.log(`${n}/${urls.length} ok subs=${data.subs.length} specs=${Object.keys(data.specs).length} imgs=${data.images.length} ${u}`);
        break;
      } catch (e) {
        console.log(`${n}/${urls.length} FAIL(${attempt}) ${u} ${e.message.split('\n')[0]}`);
        await sleep(5000);
      }
    }
    await sleep(2000);
  }
  await b.close();
  console.log('DONE');
})();
