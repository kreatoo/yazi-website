// Screenshot harness for the design-dna verify loop.
//
// Serves the site over http (file:// breaks font and fetch loading), then
// captures the page at a set of viewports into .shots/. Uses the Playwright
// browser already present in the local cache rather than installing one.
//
//   node tools/shoot.cjs               all viewports
//   node tools/shoot.cjs 1440          one width
const { chromium } = require('/Users/kreato/Sources/kvpn-website/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { extname, join, normalize } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, '.shots');
const EXEC = '/Users/kreato/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

const VIEWPORTS = {
  1440: [1440, 900],
  1024: [1024, 768],
  768: [768, 1024],
  390: [390, 844],
};

async function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const path = normalize(join(ROOT, url === '/' ? '/index.html' : url));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

(async () => {
  await mkdir(OUT, { recursive: true });
  const { server, port } = await serve();
  const browser = await chromium.launch({ executablePath: EXEC });
  const only = process.argv[2];
  const page_ = process.argv[3] || 'index.html';

  for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
    if (only && only !== name) continue;
    const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/${page_ || 'index.html'}`, { waitUntil: 'networkidle' });

    // Let the reveal observers and the terminal replay settle: scroll the whole
    // page once so every section intersects, then return to the top.
    // scroll-behavior: smooth would animate every scrollTo and the page would
    // never actually reach the offsets, so the reveal observers would miss
    // most sections. Force instant scrolling for the capture pass.
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.7);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 140));
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 500));
    });
    await page.waitForTimeout(2200);

    await page.screenshot({ path: join(OUT, `${page_.replace('.html','')}-hero-${name}.png`) });
    // fullPage capture renders position:fixed elements once, at the top, so the
    // atmosphere layer ends in a hard edge partway down the image. That is an
    // artefact of the capture, not of the page, so review frames are taken as
    // real viewport screenshots at successive scroll offsets instead.
    const offsets = await page.evaluate(() =>
      [...document.querySelectorAll('main section')].map((n) => n.offsetTop));
    let i = 0;
    for (const top of offsets) {
      await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y - 40), behavior: 'instant' }), top);
      await page.waitForTimeout(320);
      await page.screenshot({ path: join(OUT, `${page_.replace('.html','')}-view-${name}-${i}.png`) });
      i += 1;
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      height: document.body.scrollHeight,
      lines: document.querySelectorAll('.t-line').length,
      revealed: document.querySelectorAll('[data-reveal].is-revealed').length,
      revealTotal: document.querySelectorAll('[data-reveal]').length,
    }));
    console.log(name, JSON.stringify(metrics), errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no console errors');
    await page.close();
  }

  await browser.close();
  server.close();
})();
