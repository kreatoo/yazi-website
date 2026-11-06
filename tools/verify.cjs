// Behavioural verification of the interaction layer. Asserts the contract
// site.js promises, in a real browser, rather than reading the source.
const { chromium } = require('/Users/kreato/Sources/kvpn-website/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, normalize } = require('node:path');

const ROOT = join(__dirname, '..');
const EXEC = '/Users/kreato/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const path = normalize(join(ROOT, url === '/' ? '/index.html' : url));
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: EXEC });

  // ── 1. The TUI replay paints what the TUI paints ─────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    const early = await page.evaluate(() =>
      [...document.querySelectorAll('[data-terminal-out] .tui__line')].map((n) => n.textContent).join(''));
    await page.waitForTimeout(1200);
    const mid = await page.evaluate(() => ({
      lines: document.querySelectorAll('[data-terminal-out] .tui__line').length,
      typing: document.querySelectorAll('.is-typing').length,
    }));
    await page.waitForFunction(
      () => document.querySelector('[data-terminal-out] .tui__tool.is-done') &&
            document.querySelectorAll('.is-typing').length === 0 &&
            document.querySelectorAll('[data-terminal-out] .tui__line').length === 3 &&
            document.querySelector('[data-state]').textContent === '',
      null, { timeout: 20000 });
    const done = await page.evaluate(() => {
      const out = document.querySelector('[data-terminal-out]');
      const tool = out.querySelector('.tui__tool');
      return {
        user: (out.querySelector('.tui__user') || {}).textContent || '',
        assistant: [...out.querySelectorAll('.tui__assistant')].map((n) => n.textContent),
        events: [...out.querySelectorAll('.tui__event')].map((n) => n.textContent),
        toolDone: tool ? tool.classList.contains('is-done') : false,
        head: tool ? tool.querySelector('.tui__tool-head').textContent : '',
        cmd: tool ? tool.querySelector('.tui__tool-cmd').textContent : '',
        outLine: tool ? tool.querySelector('.tui__tool-out').textContent : '',
        time: tool ? tool.querySelector('.tui__tool-time').textContent : '',
        // The elapsed row must come after the output, as the TUI paints it.
        order: tool ? [...tool.children].map((n) => n.className.split(' ')[0]) : [],
        spinner: (document.querySelector('[data-spinner]') || {}).textContent || '',
        state: (document.querySelector('[data-state]') || {}).textContent || '',
      };
    });
    check('replay is mid-transcript, not pre-rendered',
      early.length > 0 && early !== 'Run the parity testsPreparing the test run.All four scenarios passed.',
      JSON.stringify(early));
    check('replay types progressively', mid.lines >= 1 && mid.lines <= 3, `lines at 1.2s: ${mid.lines}`);
    check('user message is exact', done.user === 'Run the parity tests', JSON.stringify(done.user));
    check('assistant lines are exact',
      done.assistant[0] === 'Preparing the test run.' &&
      done.assistant[1] === 'All four scenarios passed.', JSON.stringify(done.assistant));
    check('checkpoint and resume appear in order',
      done.events.join('|') === 'Checkpoint saved|Terminal disconnected|$ yazi --continue|Session restored',
      JSON.stringify(done.events));
    check('tool block reaches the done state', done.toolDone, String(done.toolDone));
    check('tool head reads "shell · done"', done.head === 'shell · done', JSON.stringify(done.head));
    check('tool command is exact', done.cmd === '$ go test ./internal/tui2/parity', JSON.stringify(done.cmd));
    check('tool output is exact', done.outLine === 'ok  internal/tui2/parity    0.12s', JSON.stringify(done.outLine));
    check('elapsed row comes after the output',
      done.order.join(',') === 'tui__tool-head,tui__tool-cmd,tui__tool-out,tui__tool-time',
      done.order.join(','));
    check('spinner and state are cleared when idle', done.spinner === '' && done.state === '',
      JSON.stringify([done.spinner, done.state]));
    await page.waitForFunction(
      () => document.querySelector('[data-terminal-live]').textContent.includes('All four scenarios passed'),
      null, { timeout: 5000 });
    const live = await page.evaluate(() => ({
      outLive: document.querySelector('[data-terminal-out]').getAttribute('aria-live'),
      liveRole: document.querySelector('[data-terminal-live]').getAttribute('role'),
      liveText: document.querySelector('[data-terminal-live]').textContent,
    }));
    check('transcript is not a live region', live.outLive === null, String(live.outLive));
    check('completed steps are announced once each',
      live.liveRole === 'log' && live.liveText.includes('Run the parity tests') &&
      live.liveText.includes('All four scenarios passed'), live.liveText.slice(0, 80));
    await page.close();
  }

  // ── 2. Reduced motion: instant, no typing ────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({
      lines: document.querySelectorAll('[data-terminal-out] .tui__line').length,
      typing: document.querySelectorAll('.is-typing').length,
      hidden: [...document.querySelectorAll('[data-reveal]')].filter((n) => getComputedStyle(n).opacity !== '1').length,
      grid: getComputedStyle(document.querySelector('.field__grid')).display,
      blobAnim: getComputedStyle(document.querySelector('.field__blob')).animationName,
    }));
    check('reduced motion paints the whole transcript instantly', st.lines === 3 && st.typing === 0, `lines ${st.lines}`);
    check('reduced motion reveals everything', st.hidden === 0, `still hidden: ${st.hidden}`);
    check('reduced motion drops the dot grid', st.grid === 'none', st.grid);
    check('reduced motion stops the drift', st.blobAnim === 'none', st.blobAnim);
    await page.close();
  }

  // ── 3. Nav material, menu, copy, counters, aria-current ──────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => document.querySelector('[data-nav]').className);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => document.querySelector('[data-nav]').className);
    check('nav gains material on scroll', !before.includes('is-scrolled') && after.includes('is-scrolled'), after);

    // copy button (install page)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(base + 'install.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.click('[data-copy]');
    await page.waitForTimeout(150);
    const copied = await page.evaluate(async () => ({
      label: document.querySelector('.snippet__copy-text').textContent,
      cls: document.querySelector('[data-copy]').className,
      clip: await navigator.clipboard.readText(),
    }));
    check('copy button labels and copies', copied.label === 'Copied' && copied.cls.includes('is-copied'),
      copied.label);
    check('clipboard holds the command',
      copied.clip === 'curl -fsSL https://yazi.krea.to/install.sh | bash', copied.clip.slice(0, 60));
    await page.waitForTimeout(1800);
    const restored = await page.evaluate(() => document.querySelector('.snippet__copy-text').textContent);
    check('copy label restores', restored === 'Copy', restored);

    // Neither clipboard method can write.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard denied'));
      document.execCommand = () => false;
    });
    await page.click('[data-copy]');
    const failure = page.locator('[data-copy-feedback]').first();
    await failure.waitFor({ state: 'visible' });
    check('copy failure is visible and announced',
      (await failure.getAttribute('role')) === 'status' &&
      (await failure.textContent()).includes('copy it manually'),
      await failure.textContent());

    // The install action marks the current page.
    await page.goto(base + 'install.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const cur = await page.evaluate(() => {
      const a = document.querySelector('.nav__actions a[aria-current="page"]');
      return a ? a.getAttribute('href') : null;
    });
    check('nav marks the current page', cur === 'install.html', String(cur));
    const home = await page.evaluate(() => {
      const a = document.querySelector('.nav__links a[href="index.html#features"]');
      return a ? a.getAttribute('aria-current') : 'missing';
    });
    check('other pages are not marked current', home === null, String(home));
    await page.close();
  }

  // ── 4. Mobile menu ───────────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base, { waitUntil: 'networkidle' });
    const closed = await page.evaluate(() => ({
      hidden: document.querySelector('[data-nav-menu]').hidden,
      exp: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
      toggleVisible: getComputedStyle(document.querySelector('[data-nav-toggle]')).display !== 'none',
    }));
    check('menu starts closed and toggle is visible', closed.hidden && closed.exp === 'false' && closed.toggleVisible,
      JSON.stringify(closed));
    await page.click('[data-nav-toggle]');
    await page.waitForTimeout(120);
    const opened = await page.evaluate(() => ({
      hidden: document.querySelector('[data-nav-menu]').hidden,
      exp: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
    }));
    check('toggle opens the menu', !opened.hidden && opened.exp === 'true', JSON.stringify(opened));
    await page.locator('[data-nav-menu] a').first().focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const esc = await page.evaluate(() => ({
      hidden: document.querySelector('[data-nav-menu]').hidden,
      exp: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
      focusRestored: document.activeElement === document.querySelector('[data-nav-toggle]'),
    }));
    check('Escape closes the menu and restores focus', esc.hidden && esc.exp === 'false' && esc.focusRestored,
      JSON.stringify(esc));
    await page.close();
  }

  // ── 5. No-JS: the page must still read ───────────────────────────────
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    const text = await page.locator('body').innerText();
    check('no-JS keeps the transcript', text.includes('All four scenarios passed.'), '');
    check('no-JS keeps headings', text.includes('Where it all') && text.includes('starts.'), '');
    await page.goto(base + 'install.html', { waitUntil: 'load' });
    // innerText excludes a collapsed <details>; textContent is the right
    // measure of "did the content survive without JS".
    const installText = await page.evaluate(() => document.body.textContent);
    check('no-JS keeps the source build and first task',
      installText.includes('go build -trimpath') && installText.includes('yazi -p'), '');
    check('no-JS hides the inert copy control', !(await page.locator('[data-copy]').first().isVisible()), '');
    await ctx.close();
  }

  // ── 6. Build from source is reachable and opens ─────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + 'install.html', { waitUntil: 'networkidle' });
    const start = await page.evaluate(() => ({
      exists: !!document.querySelector('#from-source'),
      open: document.querySelector('#from-source').open,
      // The summary must be visibly interactive, not a bare heading.
      chevron: getComputedStyle(document.querySelector('.source summary'), '::after').content !== 'none',
    }));
    check('build-from-source section exists', start.exists, String(start.exists));
    check('build-from-source starts collapsed', start.open === false, String(start.open));
    check('build-from-source has a disclosure affordance', start.chevron, String(start.chevron));

    // The jump link must scroll to it.
    await page.click('.page-jumps a[href="#from-source"]');
    await page.waitForTimeout(600);
    const reached = await page.evaluate(() => {
      const r = document.querySelector('#from-source').getBoundingClientRect();
      return { top: Math.round(r.top), inView: r.top > -80 && r.top < window.innerHeight };
    });
    check('jump link scrolls to build-from-source', reached.inView, JSON.stringify(reached));

    // And it must open, revealing the commands.
    await page.click('.source summary');
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => ({
      open: document.querySelector('#from-source').open,
      hasBuild: document.querySelector('#from-source').textContent.includes('go build -trimpath'),
      copyVisible: !!document.querySelector('#from-source [data-copy]') &&
        getComputedStyle(document.querySelector('#from-source [data-copy]')).display !== 'none',
    }));
    check('build-from-source opens on click', opened.open, String(opened.open));
    check('opened section shows the build commands', opened.hasBuild, String(opened.hasBuild));
    await page.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
