// Edge-case probes for the interaction layer: the sequences a happy-path
// harness never runs. Each probe asserts the *invariant*, not the mechanism.
const { chromium } = require('/Users/kreato/Sources/kvpn-website/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, normalize } = require('node:path');

const ROOT = join(__dirname, '..');
const EXEC = '/Users/kreato/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
// The replay adds checkpoint events between the first two typed lines and
// the tool block. EXPECTED tracks the typed lines, including the closing reply.
const EXPECTED = ['Run the parity tests', 'Preparing the test run.', 'All four scenarios passed.'];

const out = [];
function check(name, pass, detail) { out.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

const linesOf = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-terminal-out] .tui__line')].map((n) => n.textContent));
const settled = (page) => page.waitForFunction(
  () => document.querySelector('[data-terminal-out] .tui__tool.is-done') &&
        document.querySelectorAll('.is-typing').length === 0 &&
        document.querySelector('[data-state]').textContent === '',
  null, { timeout: 20000 });

(async () => {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const path = normalize(join(ROOT, url === '/' ? '/index.html' : url));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: EXEC });

  // P1: reduced motion switched ON mid-replay must not lose the in-flight line.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    // Toggle while the FIRST line is still being typed: the case where an
    // earlier renderAll() cleared the transcript and lost the in-flight line.
    await page.waitForFunction(
      () => document.querySelectorAll('.is-typing').length > 0, null, { timeout: 5000 });
    const partial = await linesOf(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(500);
    const lines = await linesOf(page);
    check('P1 toggled mid-transcript, not after completion', partial.length <= 2,
      `partial: ${JSON.stringify(partial)}`);
    check('P1 reduced-motion mid-replay keeps every line',
      lines.length === EXPECTED.length && EXPECTED.every((e, i) => lines[i] === e),
      `${lines.length} lines: ${JSON.stringify(lines)}`);
    const typing = await page.evaluate(() => document.querySelectorAll('.is-typing').length);
    check('P1 no line left mid-typing', typing === 0, `typing=${typing}`);
    const announced = await page.evaluate(() =>
      document.querySelector('[data-terminal-live]').textContent);
    const dup = EXPECTED.filter((e) => announced.split(e).length - 1 > 1);
    check('P1 announcements are not duplicated', dup.length === 0, JSON.stringify(dup));
    await page.close();
  }

  // P2: scrolled away mid-replay, then back: no duplicated or lost lines.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' }));
    await page.waitForTimeout(900);
    const away = await linesOf(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await settled(page);
    const back = await linesOf(page);
    check('P2 leaving the viewport does not lose lines', away.length > 0, `away: ${away.length}`);
    check('P2 returning completes with no duplicates',
      back.length === EXPECTED.length && EXPECTED.every((e, i) => back[i] === e),
      `${back.length} lines: ${JSON.stringify(back)}`);
    await page.close();
  }

  // P3: tab hidden mid-line, then visible: the replay must resume, not restart.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const before = await linesOf(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(800);
    const during = await linesOf(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Resuming restarts the per-line pause clock, so the tail takes a few
    // seconds longer than an uninterrupted run. Poll rather than guess.
    await settled(page);
    const after = await linesOf(page);
    check('P3 hidden tab pauses the replay', during.length === before.length,
      `${before.length} → ${during.length}`);
    check('P3 visible tab resumes to a complete, ordered transcript',
      after.length === EXPECTED.length && EXPECTED.every((e, i) => after[i] === e),
      `${after.length} lines`);
    await page.close();
  }

  // P4: menu open, then resize past the breakpoint: aria must not desync.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('[data-nav-toggle]');
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const menu = document.querySelector('[data-nav-menu]');
      const btn = document.querySelector('[data-nav-toggle]');
      return {
        hidden: menu.hidden, exp: btn.getAttribute('aria-expanded'),
        menuShown: getComputedStyle(menu).display !== 'none',
        btnShown: getComputedStyle(btn).display !== 'none',
      };
    });
    // On desktop the toggle is gone and the inline nav is used. A menu left
    // "open" behind a hidden toggle is an invisible, unreachable panel.
    check('P4 desktop resize leaves no orphan menu',
      !st.menuShown || st.btnShown, JSON.stringify(st));
    check('P4 aria-expanded matches reality after resize',
      (st.exp === 'true') === st.menuShown, JSON.stringify(st));
    await page.close();
  }

  // P5: reduced motion at load, then switched OFF: must not double-render.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(2500);
    const lines = await linesOf(page);
    check('P5 leaving reduced motion does not duplicate lines',
      lines.length === EXPECTED.length, `${lines.length} lines: ${JSON.stringify(lines)}`);
    await page.close();
  }

  // P6: the parallax must stop writing once the element is off-screen.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
    await page.waitForTimeout(400);
    const t1 = await page.evaluate(() => document.querySelector('[data-parallax]').style.transform);
    await page.evaluate(() => window.scrollTo({ top: 4600, behavior: 'instant' }));
    await page.waitForTimeout(400);
    const t2 = await page.evaluate(() => document.querySelector('[data-parallax]').style.transform);
    check('P6 parallax stops writing when off-screen', t1 === t2, `${t1} vs ${t2}`);
    await page.close();
  }

  // P7: the race sequence must reach its final state and stay there.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('[data-race]').scrollIntoView({ behavior: 'instant' }));
    // The sequence runs to 1.9s and the last row has a 280ms delay on top.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-race]');
      if (el.getAttribute('data-step') !== '3') return false;
      return [...el.querySelectorAll('.race__row')]
        .every((r) => getComputedStyle(r).opacity === '1');
    }, null, { timeout: 8000 });
    const race = await page.evaluate(() => {
      const el = document.querySelector('[data-race]');
      const rows = [...el.querySelectorAll('.race__row')].map((r) => ({
        op: getComputedStyle(r).opacity,
        verdict: r.querySelector('[data-race-verdict]').textContent,
      }));
      return { step: el.getAttribute('data-step'), rev: el.querySelector('[data-race-rev]').textContent, rows };
    });
    check('P7 race reaches step 3', race.step === '3', race.step);
    check('P7 revision advanced to 8', race.rev === '8', race.rev);
    check('P7 all three rows are visible', race.rows.every((r) => r.op === '1'), JSON.stringify(race.rows.map((r) => r.op)));
    check('P7 stale row reads rejected', race.rows[2].verdict === 'rejected', race.rows[2].verdict);
    await page.close();
  }

  // P8: the progress bar tracks scroll and is bounded to 0..1.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    const at = async (y) => {
      await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y);
      await page.waitForTimeout(220);
      return page.evaluate(() => {
        const m = getComputedStyle(document.querySelector('[data-progress]')).transform;
        return m === 'none' ? 0 : parseFloat(m.split('(')[1].split(',')[0]);
      });
    };
    const height = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const top = await at(0);
    const mid = await at(Math.round(height * 0.5));
    const bottom = await at(999999);
    check('P8 progress is zero at the top', top < 0.01, String(top));
    check('P8 progress grows with scroll', mid > top && mid < 1, String(mid));
    check('P8 progress is exactly 1 at the bottom', Math.abs(bottom - 1) < 0.02, String(bottom));
    await page.close();
  }

  // P9: split headings must be wrapped and end fully visible.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    const split = await page.evaluate(() => {
      const h = document.querySelector('.hero__title');
      const spans = [...h.querySelectorAll('.line > span')];
      return {
        count: spans.length,
        transforms: spans.map((s) => getComputedStyle(s).transform),
        text: spans.map((s) => s.textContent),
      };
    });
    check('P9 hero lines are wrapped for the mask', split.count === 2, JSON.stringify(split.text));
    check('P9 hero lines settle at translateY(0)',
      split.transforms.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'),
      JSON.stringify(split.transforms));
    await page.close();
  }

  // P10: the QR and gauge are drawn, and the gauge fills.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('[data-gauge]').scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(1800);
    const figs = await page.evaluate(() => ({
      qrCells: document.querySelectorAll('[data-qr] i').length,
      qrOn: document.querySelectorAll('[data-qr] i.on').length,
      gauge: document.querySelector('[data-gauge] i').style.transform,
    }));
    check('P10 QR is a 21x21 matrix', figs.qrCells === 441, String(figs.qrCells));
    check('P10 QR has a plausible fill', figs.qrOn > 120 && figs.qrOn < 330, String(figs.qrOn));
    check('P10 cache gauge fills to the measured rate', figs.gauge === 'scaleX(0.9824)', figs.gauge);
    await page.close();
  }

  // P11: looping micro-animations must be paused off-screen and running on.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const far = await page.evaluate(() => {
      const el = document.querySelector('.harness');
      return { live: el.classList.contains('is-live'),
        state: getComputedStyle(el.querySelector('.harness__flow'), '::after').animationPlayState };
    });
    await page.evaluate(() => document.querySelector('.harness').scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(400);
    const near = await page.evaluate(() => {
      const el = document.querySelector('.harness');
      return { live: el.classList.contains('is-live'),
        state: getComputedStyle(el.querySelector('.harness__flow'), '::after').animationPlayState };
    });
    check('P11 loops are paused while off-screen', !far.live && far.state === 'paused', JSON.stringify(far));
    check('P11 loops run while on-screen', near.live && near.state === 'running', JSON.stringify(near));
    await page.close();
  }

  // P12: no element may have two owners of `transform`. A reveal that also
  // carries parallax would have its CSS translateY silently overwritten by the
  // inline transform, so the reveal would never play.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const dual = await page.evaluate(() =>
      [...document.querySelectorAll('[data-reveal][data-parallax]')].length);
    check('P12 no element owns transform twice', dual === 0, String(dual));
    // And the hero demo must still reveal (opacity 1) while parallax runs.
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
    await page.waitForTimeout(600);
    const demo = await page.evaluate(() => {
      const outer = document.querySelector('.hero__demo');
      const inner = document.querySelector('.hero__demo-inner');
      return { op: getComputedStyle(outer).opacity, innerT: inner.style.transform };
    });
    check('P12 hero demo reveals and parallaxes independently',
      demo.op === '1' && demo.innerT.indexOf('translate3d') === 0,
      JSON.stringify(demo));
    await page.close();
  }

  await browser.close(); server.close();
  const failed = out.filter((r) => !r.pass);
  console.log(`\n${out.length - failed.length}/${out.length} edge cases pass`);
  process.exit(failed.length ? 1 : 0);
})();
