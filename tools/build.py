#!/usr/bin/env python3
"""Builds the site's HTML from one shell and two page bodies.

Why a generator: nav and footer were duplicated across pages and drifted. The
shell lives in one place here, so a link added once appears everywhere, and the
current page is marked from a table rather than by hand.

    python3 tools/build.py

Writes index.html and install.html at the repo root.
The output is checked in, so the site still opens without running this.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = ("index", "install")
SOURCE_URL = "https://src.krea.to/kreato/yazi"


HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="#151517" />
<title>{title}</title>
<meta name="description" content="{description}" />
<link rel="icon" href="assets/img/jet-logo.svg" type="image/svg+xml" />
<link rel="preload" href="assets/fonts/montserrat-light.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="assets/fonts/montserrat-medium.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="assets/css/tokens.css" />
<link rel="stylesheet" href="assets/css/tui.css" />
<link rel="stylesheet" href="assets/css/site.css" />
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

<div class="field" aria-hidden="true">
  <div class="field__blob field__blob--1"></div>
  <div class="field__blob field__blob--2"></div>
  <div class="field__blob field__blob--3"></div>
  <div class="field__grid"><div class="field__dots"></div></div>
</div>

<div class="progress" aria-hidden="true"><i data-progress></i></div>

<header class="nav" data-nav>
  <div class="nav__inner">
    <a class="brand" href="index.html" aria-label="Yazi, home">
      <img class="brand__mark" src="assets/img/jet-logo.svg" alt="" width="28" height="28" />
      <span class="brand__word">yazi</span>
    </a>
    <nav class="nav__links" aria-label="Sections">
{links}
    </nav>
    <div class="nav__actions">
      <a class="btn btn--primary btn--sm" href="install.html"{install_current}>Install Yazi</a>
      <button class="nav__toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="nav-menu" aria-label="Open menu" hidden>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <nav class="nav__menu" id="nav-menu" aria-label="Sections" data-nav-menu hidden>
{menu_links}
  </nav>
</header>

<main id="main">
"""

FOOT = """</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot__grid">
      <div class="foot__brand">
        <a class="brand" href="index.html">
          <img class="brand__mark" src="assets/img/jet-logo.svg" alt="" width="24" height="24" />
          <span class="brand__word">yazi</span>
        </a>
        <p class="foot__tag">Where it all starts. A durable coding-agent runtime for work that outlives a terminal, context window, or machine.</p>
      </div>
      <nav class="foot__col" aria-label="Mechanism">
        <p class="foot__head mono">Mechanism</p>
        <a href="index.html#revisioned-state">Revisioned state</a>
        <a href="index.html#bounded-episodes">Bounded episodes</a>
        <a href="index.html#continual-harness">Continual harness</a>
      </nav>
      <nav class="foot__col" aria-label="Product">
        <p class="foot__head mono">Product</p>
        <a href="index.html#features">Features</a>
        <a href="install.html">Install</a>
        <a href="index.html#cache">Cache benchmark</a>
        <a href="index.html#acp">Reverse ACP</a>
      </nav>
      <div class="foot__col">
        <p class="foot__head mono">Project</p>
        <p class="foot__meta">AGPL-3.0 · Go 1.26</p>
        <p class="foot__meta">Version 0.1.0-dev</p>
        <a href="https://src.krea.to/kreato/yazi">Yazi source</a>
      </div>
    </div>
    <div class="foot__base">
      <p class="foot__line">
        Yazi is an independent Go implementation based on
        <a href="https://github.com/PrimeIntellect-ai/prime-agent">Prime Agent</a>,
        created by Prime Intellect. Architecture informed by
        <a href="https://arxiv.org/abs/2608.23552">Prime Agent: A Self-Improving RLM Harness</a>
        and <a href="https://arxiv.org/abs/2310.08560">MemGPT</a>.
      </p>
      <p class="foot__line foot__line--dim">Sandboxing reduces risk; it is not a claim of perfect containment.</p>
    </div>
  </div>
</footer>

<script src="assets/js/terminal-frames.js" defer></script>
<script src="assets/js/site.js" defer></script>
</body>
</html>
"""


def links(current: str) -> str:
    """Use local fragments on the landing page and shared destinations elsewhere."""
    home = "" if current == "index" else "index.html"
    items = [
        (f"{home}#mechanisms", "How it works"),
        (f"{home}#features", "Features"),
        (SOURCE_URL, "Source"),
    ]
    return "\n".join(f'      <a href="{href}">{label}</a>' for href, label in items)


def build() -> None:
    from pages import BODIES, TITLES, DESCRIPTIONS

    for stem in PAGES:
        section_links = links(stem)
        html = (
            HEAD.format(
                title=TITLES[stem],
                description=DESCRIPTIONS[stem],
                links=section_links,
                menu_links=section_links,
                install_current=' aria-current="page"' if stem == "install" else "",
            )
            + BODIES[stem]
            + FOOT
        )
        (ROOT / f"{stem}.html").write_text(html)
        print(f"wrote {stem}.html ({len(html):,} bytes)")


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    build()
