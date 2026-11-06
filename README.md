# yazi-website

The product site for [Yazi](https://src.krea.to/kreato/yazi), a durable
coding-agent runtime.

Published at **https://yazi.krea.to**.

## What is here

```
index.html install.html   generated pages
install.sh                the curl | bash installer, hand-written, linted in CI
assets/css/tokens.css     design tokens, traced to design/dna.json
assets/css/site.css       layout, components, motion
assets/css/tui.css        the terminal
assets/js/site.js         interaction layer
assets/js/terminal-frames.js  verbatim strings from the product's TUI
design/dna.json           the Design DNA profile
tools/build.py            page generator
tools/pages_*.py          page bodies
tools/                    verification harnesses
```

## Building

The pages are generated from `tools/`, and the output is committed so the site
opens without a build.

```sh
python3 tools/build.py        # regenerate index.html and install.html
python3 tools/check-links.py  # verify internal links and anchors
python3 -m http.server 8000   # preview at http://localhost:8000
```

Editing a page means editing `tools/pages_*.py`, not the HTML. The deploy
workflow fails if the committed HTML does not match a fresh build.

`install.sh` is the exception: it is not generated. It is served as-is at
https://yazi.krea.to/install.sh, and the workflow runs `bash -n` and
`shellcheck` on it before deploying.

## Verification

```sh
node tools/verify.cjs     # 37 behavioural checks
node tools/edge.cjs       # 28 edge cases
node tools/contrast.cjs   # 34 text roles against their real backdrop
node tools/shoot.cjs 1440 index.html   # screenshots
```

The `.cjs` harnesses need Playwright and are local-only; they are not part of
the deploy. `tools/contrast.cjs` is worth knowing about: it hides each text
element, screenshots the box underneath, and measures the ratio against the
actual ground rather than the computed colour, because the page background is a
moving gradient.

## Deploying

See [DEPLOY.md](DEPLOY.md). Pushes to `main` deploy to GitHub Pages.

## Licence

AGPL-3.0. See [LICENSE](LICENSE).
