// Measures the *rendered* contrast of every text role against the pixels
// actually behind it, by screenshotting the element with the text hidden and
// sampling that box. This is the only honest way to audit text over a moving,
// semi-transparent backdrop.
const { chromium } = require('/Users/kreato/Sources/kvpn-website/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, normalize } = require('node:path');
const sharp = require('/tmp/design-dna/scripts/node_modules/sharp');

const ROOT = join(__dirname, '..');
const EXEC = '/Users/kreato/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
const over = (fg, a, bg) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));

// Every distinct text role on the page, with the selector that samples it.
const TARGETS = [
  ['h1 display', '.hero__title'],
  ['hero lede', '.hero__lede'],
  ['h2', '.section__head .h2'],
  ['section lede', '.section__head .lede'],
  ['fail card body', '.card--fail p'],
  ['fail card num', '.card--fail .card__num'],
  ['cap body', '.cap p'],
  ['cap meta', '.cap__meta'],
  ['cap number', '.cap__n'],
  ['skeleton head', '.skeleton__head'],
  ['skeleton body', '.skeleton__body'],
  ['race what', '.race__what'],
  ['race verdict', '.race__verdict'],
  ['race foot', '.race__foot'],
  ['figure note', '.figure-note'],
  ['episode head', '.episode__head'],
  ['episode item', '.episode__list li'],
  ['episode muted item', '.episode__list--muted li'],
  ['episode note', '.episode__note'],
  ['harness node', '.harness__node'],
  ['harness target', '.harness__target'],
  ['harness foot', '.harness__foot'],
  ['tick list', '.ticks li'],
  ['diagram node', '.node'],
  ['diagram col item', '.col__list li'],
  ['stat label', '.stat__l'],
  ['stat number', '.stat__n'],
  ['stats note', '.stats__note'],
  ['install note', '.install__note'],
  ['platform name', '.install__platforms dt'],
  ['platform instructions', '.install__platforms dd'],
  ['caveat', '.install__caveat'],
  ['footer link', '.foot__col a'],
  ['footer line', '.foot__line'],
  ['footer line dim', '.foot__line--dim'],
  ['nav link', '.nav__links a'],
  ['term metadata', '.tui__meta-key'],
  ['term event', '.tui__event'],
  ['term tool time', '.tui__tool-time'],
  ['term tool out', '.tui__tool-out'],
  ['demo note', '.hero__demo-note'],
  ['facts dt', '.hero__facts dt'],
  ['facts dd', '.hero__facts dd'],
  ['pagehead title', '.pagehead__title'],
  ['pagehead lede', '.pagehead__lede'],
  ['mech item body', '.mech__item p'],
  ['mech more', '.mech__more'],
  ['next label', '.next__label'],
  ['next desc', '.next__desc'],
];

(async () => {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const path = normalize(join(ROOT, url === '/' ? '/index.html' : url));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: EXEC });
  const PAGES = ['index.html', 'install.html'];
  const rows = [];
  for (const pageName of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(base + pageName, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  // settle every reveal and the replay so nothing is mid-animation
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(7000);

  for (const [name, sel] of TARGETS) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { rows.push([name, 'MISSING', '', '', '']); continue; }
    const info = await el.evaluate((n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      // Effective opacity is the product of the element's own opacity and
      // every ancestor's: getComputedStyle.color alone misses this, which is
      // exactly how dim text slipped through the first audit.
      let eff = 1, cur = n;
      while (cur && cur !== document.documentElement) {
        eff *= parseFloat(getComputedStyle(cur).opacity);
        cur = cur.parentElement;
      }
      return { color: cs.color, size: parseFloat(cs.fontSize), weight: cs.fontWeight,
        effOpacity: eff,
        x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
    });
    // hide the text, screenshot the box, restore
    await el.evaluate((n) => {
      // Hide the text, not the box: visibility:hidden would also hide the
      // element's own background and the sampler would measure what is behind
      // it. Transparent text keeps every painted surface in place.
      n.dataset.prevColor = n.style.color;
      n.style.color = 'transparent';
      n.style.textShadow = 'none';
      n.querySelectorAll('*').forEach((c) => { c.style.color = 'transparent'; });
    });
    await page.waitForTimeout(30);
    const buf = await page.screenshot({ fullPage: true });
    await el.evaluate((n) => {
      n.style.color = n.dataset.prevColor || '';
      n.querySelectorAll('*').forEach((c) => { c.style.color = ''; });
    });
    const img = sharp(buf);
    const meta = await img.metadata();
    const left = Math.max(0, Math.round(info.x)), top = Math.max(0, Math.round(info.y));
    const width = Math.max(1, Math.min(Math.round(info.w), meta.width - left));
    const height = Math.max(1, Math.min(Math.round(info.h), meta.height - top));
    const { data, info: raw } = await img.extract({ left, top, width, height })
      .raw().toBuffer({ resolveWithObject: true });
    // With the glyphs transparent, the modal colour in the box is the ground.
    // The brightest pixel would be a residual antialiasing edge, which is not
    // what the text sits on.
    const counts = new Map();
    for (let i = 0; i < data.length; i += raw.channels) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = 0, bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    const worst = [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255];
    const fg = parse(info.color);
    // Composite twice: the colour's own alpha, then the inherited opacity.
    const afterAlpha = fg.a < 1 ? over(fg.rgb, fg.a, worst) : fg.rgb;
    const composed = info.effOpacity < 1 ? over(afterAlpha, info.effOpacity, worst) : afterAlpha;
    const r = ratio(composed, worst);
    const large = info.size >= 24 || (info.size >= 18.66 && +info.weight >= 700);
    const need = large ? 3 : 4.5;
    rows.push([`${pageName.replace('.html', '')} · ${name}`, r.toFixed(2), need, r >= need ? 'PASS' : 'FAIL',
      `fg rgb(${fg.rgb})${info.effOpacity < 1 ? ` @opacity ${info.effOpacity.toFixed(2)}` : ''} on worst px rgb(${worst}) ${info.size}px/${info.weight}`]);
  }
  await page.close();
  }

  // A selector that does not exist on a given page is expected across four
  // pages; only real failures count.
  const present = rows.filter((r) => r[3] !== '');
  const fails = present.filter((r) => r[3] === 'FAIL');
  present.sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));
  for (const [n, r, need, verdict, d] of present) console.log(`${String(r).padStart(6)}  need ${need}  ${verdict.padEnd(5)} ${n.padEnd(26)} ${d}`);
  console.log(`\n${present.length - fails.length}/${present.length} text roles pass WCAG AA against their real backdrop`);
  await browser.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})();
