/* ─────────────────────────────────────────────────────────────────────────
   site.js — interaction layer for the Yazi product page.

   CONTRACT
   Deferred classic script: ES2020, IIFE, no modules, no build, no deps. It
   reads the markup and window.YAZI_TUI, and progressively enhances the page. Enhancement only: without JS the terminal keeps its static
   transcript, the counters keep their pre-rendered "1,225", the menu stays
   closed because `hidden` is in the markup. Hence `if (!el) return` everywhere
   and one feature per function, so a missing element cannot break the rest.
   One global (idempotency flag), one matchMedia for reduced motion, no layout
   reads inside scroll handlers, no global key handler except Escape.

   WHY EACH LOOP EXISTS
   nav       passive scroll only sets a flag; one rAF flips the class, so
             scrolling never pays for style work.
   menu      Escape, outside click and link click close; `hidden` and
             aria-expanded are written together so they cannot drift.
   reveal    one observer, one shot per element, then unobserved — a reveal
             never reverses. A per-parent index staggers grids into a cascade.
   terminal  one rAF scheduler with a deadline cursor: per-character jitter,
             no timers, and the loop stops when the tab is hidden or the
             terminal leaves the viewport.
   copy      one timer per button, so repeat clicks cannot strand a label.
   stats     one rAF loop for 1100ms, eased, then the DOM is left alone.
   parallax  one rAF loop reading scrollY once per frame and writing only
             transforms, so it cannot thrash layout.
   section   one observer over main section[id] keeps aria-current on the link
             of the section being read.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Idempotency: a second load of this file must change nothing.
  if (window.__yaziSiteReady) return;
  window.__yaziSiteReady = true;

  var reduceQuery = window.matchMedia ?
    window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var prefersReduced = !!(reduceQuery && reduceQuery.matches);
  var handlers = [];
  var supportsIO = typeof window.IntersectionObserver === 'function';
  var raf = window.requestAnimationFrame.bind(window);

  // Single subscription point for "the motion preference just changed".
  function onReducedChange(fn) { handlers.push(fn); }
  function handleReducedChange(event) {
    prefersReduced = event.matches;
    handlers.forEach(function (fn) {
      try {
        fn(prefersReduced);
      } catch (err) {
        // One broken subscriber must not stop the others from settling.
      }
    });
  }
  if (reduceQuery && reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', handleReducedChange);
  } else if (reduceQuery) {
    reduceQuery.addListener(handleReducedChange); // Safari < 14
  }

  /* 1 — NAV MATERIAL ────────────────────────────────────────────────────── */
  function initNav() {
    var nav = document.querySelector('[data-nav]');
    if (!nav) return;
    var queued = false;
    function apply() {
      queued = false;
      nav.classList.toggle('is-scrolled', (window.scrollY || window.pageYOffset) > 8);
    }
    window.addEventListener('scroll', function () {
      if (queued) return; // no work per event beyond this flag
      queued = true;
      raf(apply);
    }, { passive: true });
    apply(); // the page may load already scrolled (reload, anchor link)
  }

  /* 2 — MOBILE MENU ─────────────────────────────────────────────────────── */
  function initMenu() {
    var nav = document.querySelector('[data-nav]');
    var toggle = document.querySelector('[data-nav-toggle]');
    var menu = document.querySelector('[data-nav-menu]');
    if (!nav || !toggle || !menu) return;
    function isOpen() { return toggle.getAttribute('aria-expanded') === 'true'; }
    // `hidden` and aria-expanded are written together, always, in one place.
    function setOpen(open) {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    function close() { if (isOpen()) setOpen(false); }
    toggle.addEventListener('click', function () { setOpen(!isOpen()); });
    // Any link in the menu scrolls in-page; close so the target is visible.
    menu.addEventListener('click', function (event) {
      var el = event.target;
      if (el && el.closest && el.closest('a')) close();
    });
    // The page's only global key handler.
    document.addEventListener('keydown', function (event) {
      if ((event.key === 'Escape' || event.key === 'Esc') && isOpen()) {
        var restoreFocus = menu.contains(document.activeElement);
        close();
        if (restoreFocus) toggle.focus();
      }
    });
    // The toggle sits inside the header, so its own click never reaches this
    // branch and cannot fight the toggle handler above.
    document.addEventListener('click', function (event) {
      if (isOpen() && !(event.target && nav.contains(event.target))) close();
    });
    setOpen(false);
    toggle.hidden = false;

    // Above the breakpoint the toggle is display:none and the inline nav takes
    // over. A menu left open behind it would keep aria-expanded="true" on a
    // control nobody can see or reach, so crossing the breakpoint closes it.
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 901px)');
      var onWide = function (event) { if (event.matches) setOpen(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }
  }

  /* 3 — REVEAL ON SCROLL ────────────────────────────────────────────────── */
  function initReveal() {
    var nodes = document.querySelectorAll('[data-reveal]');
    if (!nodes.length) return;
    var delays = new Map(), perParent = new Map(), io = null;
    nodes.forEach(function (el) {
      // Document order, so counting per parent yields this element's index
      // among the revealed siblings of that parent.
      var index = perParent.get(el.parentNode) || 0;
      perParent.set(el.parentNode, index + 1);
      delays.set(el, Math.min(index * 60, 240));
    });
    function reveal(el, delay) {
      if (el.classList.contains('is-revealed')) return;
      if (delay > 0) {
        el.style.transitionDelay = delay + 'ms';
        el.addEventListener('transitionend', function () {
          el.style.transitionDelay = '';
        }, { once: true });
        // Safety net for CSS that declares no transition at all.
        window.setTimeout(function () {
          // The element may have been removed before the safety net fired.
          if (el.isConnected) el.style.transitionDelay = '';
        }, delay + 900);
      }
      el.classList.add('is-revealed');
    }
    function revealAll() {
      if (io) io.disconnect();
      io = null;
      nodes.forEach(function (el) { reveal(el, 0); });
    }
    // No observer, or the user asked for less motion: show everything now.
    if (prefersReduced || !supportsIO) return revealAll();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target); // plays once, never reverses
        reveal(entry.target, delays.get(entry.target) || 0);
      });
    }, { threshold: [0.15], rootMargin: '0px 0px -8% 0px' });
    nodes.forEach(function (el) { io.observe(el); });
    // Motion switched on mid-session: settle the rest without animation.
    onReducedChange(function (on) { if (on) revealAll(); });
  }

  /* 4 — THE TUI REPLAY ──────────────────────────────────────────────────── */
  //
  // Paints what yazi's TUI paints, in the order it paints it, from
  // window.YAZI_TUI. The steps are elements, not lines: a tool call is one
  // block whose head, command, output and elapsed row appear in sequence, and
  // whose background changes from toolPendingBg to toolSuccessBg when it
  // finishes. That transition is the whole point of the demo, so it is a real
  // state change on a real element rather than a colour written into a string.
  function initTerminal() {
    var term = document.querySelector('[data-terminal]');
    var out = term && term.querySelector('[data-terminal-out]');
    var live = term && term.querySelector('[data-terminal-live]');
    var spinner = term && term.querySelector('[data-spinner]');
    var stateEl = term && term.querySelector('[data-state]');
    var data = window.YAZI_TUI;
    if (!term || !out || !data || !data.steps || !data.steps.length) return;

    var steps = data.steps;
    var rafId = 0, started = false, finished = false, offscreen = false;
    var index = 0, deadline = 0, active = null, shown = 0, toolBlock = null;

    // The TUI's spinner frames, from internal/tui2/widgets/spinner.go.
    var FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    var frame = 0, spinTimer = 0;

    function startSpinner() {
      if (spinTimer || prefersReduced || !spinner) return;
      spinTimer = window.setInterval(function () {
        if (document.hidden || offscreen) return;
        frame = (frame + 1) % FRAMES.length;
        spinner.textContent = FRAMES[frame];
      }, 90);
    }
    function stopSpinner() {
      if (!spinTimer) return;
      window.clearInterval(spinTimer);
      spinTimer = 0;
    }

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function clearOut() {
      while (out.firstChild) out.removeChild(out.firstChild);
    }

    // The transcript is not a live region: a per-character announce would be
    // unusable. Each finished step is mirrored into the role=log region once.
    // Idempotent: renderAll() rebuilds the transcript from the start, so a
    // line that was already announced must not be announced again.
    var announced = Object.create(null);
    function announce(text) {
      if (!live || !text) return;
      var t = text.trim();
      if (announced[t]) return;
      announced[t] = true;
      var item = document.createElement('span');
      item.textContent = /[.!?:]$/.test(t) ? t + ' ' : t + '. ';
      live.appendChild(item);
    }

    function schedule() {
      if (!rafId && !finished) rafId = raf(tick);
    }
    function stopLoop() {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // Type into an element at the TUI's own pace: fast, because a terminal
    // does not type slowly for effect.
    function typeInto(node, text, now, done) {
      active = { node: node, text: text, done: done };
      shown = 0;
      node.classList.add('is-typing');
      deadline = now + 8 + Math.random() * 14;
    }

    function finishActive(now) {
      if (!active) return;
      active.node.textContent = active.text;
      active.node.classList.remove('is-typing');
      var done = active.done;
      active = null;
      if (done) done(now);
    }

    // One step of the transcript. Each returns the delay before the next.
    function beginStep(now) {
      var step = steps[index++];
      if (!step) { finish(now); return; }

      if (step.kind === 'user') {
        var u = el('p', 'tui__user tui__line');
        out.appendChild(u);
        typeInto(u, step.text, now, function () { announce(step.text); deadline = now + 260; });
        return;
      }

      if (step.kind === 'assistant') {
        var a = el('p', 'tui__assistant tui__line');
        out.appendChild(a);
        typeInto(a, step.text, now, function () { announce(step.text); deadline = now + 220; });
        return;
      }

      if (step.kind === 'event') {
        var stateClass = step.state ? ' ' + step.state : '';
        out.appendChild(el('p', 'tui__event' + stateClass, step.text));
        announce(step.text);
        deadline = now + (step.hold || 460);
        return;
      }

      if (step.kind === 'tool') {
        // The block: head, command, output, elapsed. Painted at once, because
        // the TUI paints the frame, not the characters.
        toolBlock = el('div', 'tui__tool');
        var head = el('div', 'tui__tool-head');
        head.appendChild(el('span', null, step.head));
        head.appendChild(el('span', 'tui__tool-state', step.state));
        toolBlock.appendChild(head);
        if (step.cmd) toolBlock.appendChild(el('div', 'tui__tool-cmd', step.cmd));
        // The elapsed row is painted last, after the output, so it is created
        // on the done step rather than here.
        out.appendChild(toolBlock);
        if (stateEl) stateEl.textContent = 'working';
        startSpinner();
        announce(step.head + step.state);
        deadline = now + 520;
        return;
      }

      if (step.kind === 'tool-out') {
        if (toolBlock) toolBlock.appendChild(el('div', 'tui__tool-out', step.text));
        deadline = now + 420;
        return;
      }

      if (step.kind === 'tool-done') {
        if (toolBlock) {
          var st = toolBlock.querySelector('.tui__tool-state');
          if (st) st.textContent = step.state;
          toolBlock.classList.add('is-done');
          toolBlock.appendChild(el('div', 'tui__tool-time', step.time));
        }
        deadline = now + 460;
        return;
      }

      deadline = now + 120;
    }

    function finish(now) {
      finished = true;
      stopLoop();
      stopSpinner();
      if (stateEl) stateEl.textContent = '';
      if (spinner) spinner.textContent = '';
      // Make sure the last step is fully painted even if we stopped mid-type.
      finishActive(now || window.performance.now());
      while (index < steps.length) beginStep(window.performance.now());
    }

    // Everything at once, for reduced motion or no observer.
    function renderAll() {
      stopLoop();
      stopSpinner();
      clearOut();
      active = null;
      index = 0;
      while (index < steps.length) {
        beginStep(0);
        finishActive(0);
      }
      finished = true;
      stopSpinner();
      if (stateEl) stateEl.textContent = '';
      if (spinner) spinner.textContent = '';
    }

    function tick(now) {
      rafId = 0;
      if (finished) return;
      if (document.hidden || offscreen) return;
      // At most a few characters per frame, so a stalled tab cannot dump a
      // whole line in one paint.
      for (var budget = 4; budget > 0; budget--) {
        if (active) {
          if (now < deadline) break;
          shown += 1;
          active.node.textContent = active.text.slice(0, shown);
          if (shown >= active.text.length) finishActive(now);
          else deadline = now + 8 + Math.random() * 14;
          continue;
        }
        if (now < deadline) break;
        beginStep(now);
      }
      schedule();
    }

    function begin() {
      if (started) return;
      started = true;
      clearOut();
      deadline = 0;
      schedule();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return stopLoop();
      if (started && !finished && !offscreen) {
        deadline = window.performance.now();
        schedule();
      }
    });
    onReducedChange(function (on) { if (on) renderAll(); });
    if (prefersReduced || !supportsIO) return renderAll();

    clearOut(); // Keep the static frame until the replay can take over.
    var io = new IntersectionObserver(function (entries) {
      var entry = entries[entries.length - 1];
      if (!entry) return;
      if (!started) {
        if (entry.intersectionRatio < 0.25) return;
        begin();
        return;
      }
      if (finished) { io.disconnect(); return; }
      offscreen = !entry.isIntersecting;
      if (offscreen) return stopLoop();
      deadline = Math.max(deadline, window.performance.now());
      schedule();
    }, { threshold: [0, 0.25] });
    io.observe(term);
  }

  /* 5 — COPY BUTTONS ────────────────────────────────────────────────────── */
  function copyText(text) {
    // Fallback for insecure contexts and denied clipboard permission.
    function legacy() {
      var area = document.createElement('textarea'), ok = false;
      var focused = document.activeElement;
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(area);
      try {
        area.select();
        area.setSelectionRange(0, area.value.length);
        ok = document.execCommand('copy');
      } catch (err) { ok = false; }
      document.body.removeChild(area);
      if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }, legacy);
    }
    return Promise.resolve(legacy());
  }

  function initCopy() {
    document.querySelectorAll('[data-copy]').forEach(function (button) {
      var host = button.closest ? button.closest('[data-copy-host]') : null;
      var code = host && host.querySelector('.snippet__code');
      var feedback = host && host.nextElementSibling;
      if (!code || !feedback || !feedback.hasAttribute('data-copy-feedback')) return;
      var label = button.querySelector('.snippet__copy-text');
      var timer = 0, attempt = 0;

      button.hidden = false;
      button.addEventListener('click', function () {
        var text = (code.textContent || '').trim();
        if (!text) return;
        var request = ++attempt;
        window.clearTimeout(timer);
        feedback.textContent = '';
        feedback.classList.add('sr-only');
        button.classList.remove('is-copied');
        label.textContent = 'Copy';

        copyText(text).then(function (ok) {
          if (request !== attempt) return;
          if (!ok) {
            feedback.classList.remove('sr-only');
            feedback.textContent = 'Couldn’t copy. Select the command to copy it manually.';
            return;
          }
          label.textContent = 'Copied';
          button.classList.add('is-copied');
          feedback.textContent = 'Command copied.';
          timer = window.setTimeout(function () {
            button.classList.remove('is-copied');
            label.textContent = 'Copy';
          }, 1600);
        });
      });
    });
  }

  /* 6 — STAT COUNTERS ───────────────────────────────────────────────────── */
  function initStats() {
    var block = document.querySelector('.stats');
    if (!block) return;
    var nodes = block.querySelectorAll('[data-count]');
    if (!nodes.length || prefersReduced) return; // pre-rendered text is right
    var targets = [];
    nodes.forEach(function (el) {
      var n = parseInt(el.getAttribute('data-count'), 10);
      if (isFinite(n)) targets.push({ el: el, value: n, final: el.textContent });
    });
    if (!targets.length) return;

    var rafId = 0;
    // Restore the authored strings: the final value is never recomputed.
    function settle() {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
      targets.forEach(function (t) { t.el.textContent = t.final; });
    }
    function tween() {
      var start = 0;
      function step(now) {
        rafId = 0;
        if (!start) start = now;
        var progress = Math.min(1, (now - start) / 1100);
        if (progress >= 1) return settle();
        var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        targets.forEach(function (t) {
          t.el.textContent = Math.round(t.value * eased).toLocaleString('en-US');
        });
        rafId = raf(step);
      }
      rafId = raf(step);
    }
    onReducedChange(function (on) { if (on) settle(); });
    if (!supportsIO) return; // cannot know when it is visible: leave the text
    var io = new IntersectionObserver(function (entries) {
      if (!entries[entries.length - 1].isIntersecting) return;
      io.disconnect();
      if (!prefersReduced) tween();
    }, { threshold: [0.4] });
    io.observe(block);
  }

  /* 7 — PARALLAX ────────────────────────────────────────────────────────── */
  function initParallax() {
    var items = [], byEl = new Map();
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      var factor = parseFloat(el.getAttribute('data-parallax'));
      if (!isFinite(factor) || factor === 0) return;
      var item = { el: el, factor: factor, visible: !supportsIO };
      items.push(item);
      byEl.set(el, item);
    });
    if (!items.length) return;

    var enabled = !prefersReduced, queued = false;
    function apply() {
      queued = false;
      if (!enabled) return;
      var y = window.scrollY || window.pageYOffset || 0; // one read per frame
      items.forEach(function (item) {
        if (!item.visible) return;
        var off = Math.max(-40, Math.min(40, y * item.factor)).toFixed(2);
        item.el.style.transform = 'translate3d(0, ' + off + 'px, 0)';
      });
    }
    function queue() {
      if (queued || !enabled) return;
      queued = true;
      raf(apply);
    }
    window.addEventListener('scroll', queue, { passive: true });
    if (supportsIO) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var hit = byEl.get(entry.target);
          if (hit) hit.visible = entry.isIntersecting;
        });
        queue(); // it may re-enter at a new scroll position
      }, { threshold: [0] });
      items.forEach(function (item) { io.observe(item.el); });
    }
    onReducedChange(function (on) {
      enabled = !on;
      if (on) items.forEach(function (item) { item.el.style.transform = ''; });
      else queue();
    });
    queue();
  }

  /* 8 — CURRENT SECTION ─────────────────────────────────────────────────── */
  function initCurrentSection() {
    var sections = document.querySelectorAll('main section[id]');
    var links = document.querySelectorAll(
      '[data-nav] .nav__links a, [data-nav] .nav__menu a'
    );
    if (!sections.length || !links.length || !supportsIO) return;

    var byId = {}, current = null, seen = new Map(), inPage = [];
    links.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#' || href.length < 2) return;
      // Only links that point at an in-page anchor are managed here. A link to
      // another page carries its aria-current from the build, and stripping it
      // would leave the current page unmarked.
      inPage.push(link);
      (byId[href.slice(1)] || (byId[href.slice(1)] = [])).push(link);
    });
    if (!inPage.length) return;
    function setCurrent(section) {
      if (section === current) return;
      current = section;
      var matches = (section && byId[section.id]) || [];
      inPage.forEach(function (link) {
        if (matches.indexOf(link) < 0) link.removeAttribute('aria-current');
        else link.setAttribute('aria-current', 'page');
      });
    }
    function update() {
      var best = null, bestTop = Infinity;
      // A layout read, but only when intersections change — never per scroll.
      seen.forEach(function (on, section) {
        var top = section.getBoundingClientRect().top;
        if (top < bestTop) { bestTop = top; best = section; }
      });
      setCurrent(best);
    }
    // A thin band near the top of the viewport: usually exactly one section
    // intersects it, and "topmost visible" then means "what you are reading".
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) seen.set(entry.target, true);
        else seen.delete(entry.target);
      });
      update();
    }, { threshold: [0], rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (section) { io.observe(section); });
  }

  /* BOOTSTRAP ───────────────────────────────────────────────────────────── */
  // Deferred, so the DOM is normally parsed; keep the guard for inline use.

  /* 9 — SPLIT LINES ─────────────────────────────────────────────────────── */
  // Headings marked [data-split] rise out of a mask, one line at a time. The
  // markup already wraps each line in .line (a real line break, so the text
  // wraps identically with and without JS); this only wraps the inner text in
  // a span and indexes it for the stagger.
  function initSplit() {
    var heads = document.querySelectorAll('[data-split]');
    heads.forEach(function (head) {
      // The marked element may itself be a line, or contain several.
      var lines = head.classList.contains('line')
        ? [head]
        : head.querySelectorAll('.line');
      lines.forEach(function (line, i) {
        if (line.firstElementChild) return; // already wrapped
        var inner = document.createElement('span');
        inner.textContent = line.textContent;
        line.textContent = '';
        line.appendChild(inner);
        inner.style.setProperty('--i', String(i));
      });
    });
  }

  /* 10 — SECTION RULES ──────────────────────────────────────────────────── */
  // The hairline above each section draws itself left-to-right when the
  // section arrives. It is the page's connective tissue: the rule is what the
  // eye follows from one section into the next.
  function initSectionRules() {
    var rules = document.querySelectorAll('.section--rule');
    if (!rules.length) return;
    if (prefersReduced || !supportsIO) {
      rules.forEach(function (r) { r.classList.add('is-revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        entry.target.classList.add('is-revealed');
      });
    }, { threshold: [0], rootMargin: '0px 0px -12% 0px' });
    rules.forEach(function (r) { io.observe(r); });
  }

  /* 11 — READING PROGRESS ───────────────────────────────────────────────── */
  // One 1px line, scaled on X. Reads scrollY once per frame and writes only a
  // transform, so it cannot cause layout work while scrolling.
  function initProgress() {
    var bar = document.querySelector('[data-progress]');
    if (!bar) return;
    var queued = false;
    function apply() {
      queued = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    function queue() {
      if (queued) return;
      queued = true;
      raf(apply);
    }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    apply();
  }

  /* 12 — THE RACE ───────────────────────────────────────────────────────── */
  // The claim figure is the page's central argument, so it is the one thing
  // that animates as a *sequence* rather than a reveal: worker A is accepted,
  // worker B is accepted, then B's retry is rejected because its revision is
  // stale. Steps advance on data-step, which the CSS reads — the animation is
  // declarative, and the final state is the state the markup describes.
  function initRace() {
    var race = document.querySelector('[data-race]');
    if (!race) return;
    var rev = race.querySelector('[data-race-rev]');

    function finish() {
      race.setAttribute('data-step', '3');
      if (rev) rev.textContent = '8';
    }
    if (prefersReduced || !supportsIO) return finish();

    var timers = [];
    function step(n, delay) {
      timers.push(window.setTimeout(function () {
        race.setAttribute('data-step', String(n));
        // The revision only advances once A's checkpoint lands.
        if (n >= 2 && rev) rev.textContent = '8';
      }, delay));
    }
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      step(1, 120);
      step(2, 900);
      step(3, 1900);
    }, { threshold: [0.35] });
    io.observe(race);

    // Reduced motion switched on mid-sequence: settle immediately.
    onReducedChange(function (on) {
      if (!on) return;
      timers.forEach(function (t) { window.clearTimeout(t); });
      finish();
    });
  }

  /* 13 — MAGNETIC BUTTONS ───────────────────────────────────────────────── */
  // The pointer pulls a button's contents a few pixels toward itself. Small
  // enough to read as responsiveness rather than as a gimmick: max 4px, and
  // only on fine pointers where hover exists.
  function initMagnetic() {
    if (prefersReduced) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var targets = document.querySelectorAll('[data-magnetic]');
    targets.forEach(function (el) {
      var frame = 0;
      el.addEventListener('pointermove', function (event) {
        if (frame) return;
        frame = raf(function () {
          frame = 0;
          var r = el.getBoundingClientRect();
          var dx = (event.clientX - (r.left + r.width / 2)) / (r.width / 2);
          var dy = (event.clientY - (r.top + r.height / 2)) / (r.height / 2);
          el.style.transform = 'translate3d(' + (dx * 4).toFixed(2) + 'px, ' +
            (dy * 3).toFixed(2) + 'px, 0)';
        });
      });
      el.addEventListener('pointerleave', function () {
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        el.style.transform = '';
      });
    });
  }


  /* 14 — THE QR ─────────────────────────────────────────────────────────── */
  // The pairing code is drawn as a deterministic dot matrix rather than an
  // image: it scales with the card, costs nothing to load, and reads as a QR
  // at a glance. It is decorative here (aria-hidden) — the real code is
  // printed by the daemon when the web surface starts.
  function initQR() {
    var qr = document.querySelector('[data-qr]');
    if (!qr) return;
    var N = 21;
    // A fixed seed keeps the pattern stable across reloads; a QR that
    // reshuffles on every paint would look like a bug.
    var seed = 0x5f3a91;
    function rnd() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 1000) / 1000;
    }
    var cells = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        // Finder patterns in three corners, like a real code.
        var finder =
          (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
        var on;
        if (finder) {
          var lx = x >= N - 7 ? x - (N - 7) : x;
          var ly = y >= N - 7 ? y - (N - 7) : y;
          var ring = Math.max(Math.abs(lx - 3), Math.abs(ly - 3));
          on = ring === 3 || ring <= 1;
        } else {
          on = rnd() > 0.52;
        }
        cells.push(on);
      }
    }
    var frag = document.createDocumentFragment();
    cells.forEach(function (on) {
      var cell = document.createElement('i');
      if (on) cell.className = 'on';
      frag.appendChild(cell);
    });
    qr.appendChild(frag);
  }

  /* 15 — THE CACHE GAUGE ────────────────────────────────────────────────── */
  // The gauge shows the measured warm cache rate from the loopback test.
  function initGauge() {
    var gauge = document.querySelector('[data-gauge]');
    if (!gauge) return;
    var fill = gauge.firstElementChild;
    if (!fill) return;
    // The measured warm cache rate from benchmarks/cache/results/
    // 2026-10-25-churn-notice-v2 (98.24%). Drawn, not rounded.
    function set() { fill.style.transform = 'scaleX(0.9824)'; }
    if (prefersReduced || !supportsIO) return set();
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      set();
    }, { threshold: [0.5] });
    io.observe(gauge);
  }


  /* 16 — LIVE FIGURES ────────────────────────────────────────────────────── */
  // The looping micro-animations (pipeline pulse, imp bob, ACP swap, arrow
  // nudge) are paused in CSS and only run while their figure is on screen.
  // One observer for all of them, and it disconnects when there is nothing
  // left to watch.
  function initLiveFigures() {
    var figures = document.querySelectorAll(
      '.harness, .acp, .episode'
    );
    if (!figures.length) return;
    if (prefersReduced || !supportsIO) return; // CSS already leaves them paused
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-live', entry.isIntersecting);
      });
    }, { threshold: [0] });
    figures.forEach(function (el) { io.observe(el); });
  }

  function boot() {
    initSplit();
    initNav();
    initMenu();
    initReveal();
    initTerminal();
    initCopy();
    initStats();
    initParallax();
    initCurrentSection();
    initSectionRules();
    initProgress();
    initRace();
    initMagnetic();
    initQR();
    initGauge();
    initLiveFigures();
    document.documentElement.classList.add('js');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
