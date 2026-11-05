# Design notes

How this site was made, so it can be maintained rather than guessed at.

## Structure

Two pages. The landing page carries the whole argument; the install page guides a first run and keeps the command reference close.

| Page | Job |
| --- | --- |
| `index.html` | Product promise, checkpoint replay, mechanisms, workflows, tools and install |
| `install.html` | OS choices, provider setup, a first task, source builds and command reference |

Pages are generated so nav and footer cannot drift:

```sh
python3 tools/build.py
```

`tools/build.py` holds the shell (head, nav, footer). `tools/pages_index.py` and
`tools/pages_install.py` hold the bodies. The output is checked in, so the site
still opens without running the build.

### What the landing page deliberately does not have

A previous version had a spec-sheet row of facts under the hero (written in,
authority, targets, licence), a caption under the terminal explaining that it
was painted from the render code, a statistics band, and a full architecture
diagram. None of that sells a product. The facts moved into the prose where they
matter, the caption was deleted because the terminal speaks for itself, and the
architecture diagram lives in the repository docs where a reader who wants it
will look.

The landing page shows the resume workflow first, then explains the runtime
mechanisms and supporting tools before pointing to the OS-specific quickstart.

## The three artefacts

| File | What it is |
| --- | --- |
| `design/dna.json` | A Design DNA profile: measurable tokens, qualitative style, visual-effects spec. Extracted from the shipped product. |
| `assets/css/tokens.css` | The DNA as CSS custom properties. The only file allowed to declare a colour, radius, shadow or type size. |
| `assets/css/site.css` | Layout and components. Declares no design value of its own. |
| `assets/css/tui.css` | The terminal. Separate because the terminal has its own palette. |

## The terminal

The first version was a fake macOS window with traffic lights. It looked nothing
like Yazi, which is a terminal application. The current one is built from the
render code:

| Source | What it gives |
| --- | --- |
| `internal/tui2/app/header.go` | `brandLogo`, the 7-row ASCII butterfly |
| `internal/tui2/app/header_splash.go` | The metadata block: version, sessions, endpoints, cwd |
| `internal/tui2/app/root.go` | `paintHint`: state left, expansion mode right |
| `internal/tui2/parity/testdata/tool-call-80.txt` | Exact glyphs, indents, spacing |
| `internal/tui2/theme/data/dark.json` | The colours |

Geometry that a generic terminal mock gets wrong, and that this one gets right:

- No window chrome. No traffic lights, no title bar, no rounded card.
- The user's message is indented two columns on its own background. The
  assistant's reply is indented one.
- A tool call is a block: `shell · ◇ running`, the command, the output, then
  `Took 0.0s`. The elapsed row comes last, because that is where the TUI paints
  it.
- The hint row shows activity on the left and identifies the demo as an
  illustrative replay on the right.
- The prompt is ` >` with one leading space.
- The palette is the TUI's own dark theme, not the website's.

`assets/js/terminal-frames.js` holds the splash and tool output from those files
and adds an illustrative checkpoint and reconnect sequence.
`tools/verify.cjs` checks the sequence and the child order inside the tool block.

## Where the DNA came from

The reference is the shipped Yazi web client, captured and measured:

```sh
cd ../yazi/internal/remoteui/assets/app && python3 -m http.server 8899
node tools/shoot.cjs 1440 index.html
node /tmp/design-dna/scripts/measure-colors.mjs .shots/index-hero-1440.png --k 16
```

The measured palette is in `design/dna.json` under
`design_system.color.measured_palette`, with the clustering configuration in
`design_system.color.measurement` so the check can be re-run.

Two neutral steps were lifted from the reference (`#81848a` → `#94989e`,
`#64666b` → `#8c9096`). The reference sets no copy over the brightest part of its
drifting field; this site does, and at the field's peak the reference's dim
values fall to 1.9:1. The lift is recorded in `design_system.color.neutral.usage`
so it reads as a decision.

## Verification

```sh
python3 tools/build.py    # regenerate both pages
node tools/verify.cjs     # 28 behavioural checks
node tools/edge.cjs       # 28 edge cases
node tools/contrast.cjs   # 35 text roles, both pages
node tools/shoot.cjs 1440 index.html      # screenshots, per page
```

`tools/contrast.cjs` hides each text element, screenshots the box underneath it,
samples the brightest pixel in that box, and computes the ratio against the text
colour, including `opacity` multiplied down through ancestors. Reading
`getComputedStyle().color` is not enough on a background that moves; the first
version of this audit passed 28 roles and was still wrong.

### The design-dna colour check

```sh
cd /tmp/design-dna/scripts
node verify.mjs <screenshot> <measured.json>
```

Colour fidelity passes: mean ΔE 3.17, max ΔE 9.56 (thresholds 5 and 20).
Coverage drift does not pass (0.82 against 0.35), and that is expected: the
reference is an application frame with a 280px solid sidebar, while a marketing
hero is one field with two text columns. Drift here measures composition, not
colour.

## Motion

Four layers, in order of application:

1. **Entrance**: masked line-rise for headings, fade-up for blocks, 60ms stagger.
2. **Scroll**: progress bar, nav material, parallax, section rules that draw.
3. **Crossover**: the effects that carry an idea between sections. The claim race
   on `runtime.html` is the clearest one: two workers, one stale, struck through
   and rejected.
4. **Feedback**: magnetic buttons, card lift, copy confirmation, caret.

Rules the implementation holds to:

- **One owner of `transform` per element.** Reveal owns it on `[data-reveal]`,
  parallax on `[data-parallax]`, magnetic on `[data-magnetic]`. Where two would
  collide, the markup nests them. `tools/edge.cjs` P12 enforces this.
- **Only `transform` and `opacity` animate.** No layout property transitions.
- **Nothing loops off-screen.** The looping micro-animations are paused in CSS
  and released by an observer while visible.
- **`prefers-reduced-motion` is a real branch.** The replay paints instantly, the
  race jumps to its final state, the gauge fills, the field holds still, and the
  dot grid is removed.

## Text

Written to the no-ai-slop rules. No binary contrasts, no colon reveals, no
throat-clearing, no importance puffery, no em dashes as rhythm, no recap
endings. Every claim carries a number, a mechanism, or a consequence.

The figures are counted, not estimated:

```sh
find . -name '*.go' -not -path './web/*' | wc -l                    # 1,225
find . -name '*.go' -not -path './web/*' -exec cat {} + | wc -l      # 247,094
go list ./internal/... | wc -l                                       # 130
find . -name '*_test.go' | wc -l                                     # 650
```

The cache figure (98.24% warm, 380 uncached tokens per turn) comes from
`benchmarks/cache/results/2026-10-25-churn-notice-v2`.

## Files

```
index.html install.html  generated pages
assets/css/tokens.css    tokens (traces to design/dna.json)
assets/css/site.css      layout, components, motion
assets/css/tui.css       the terminal
assets/js/site.js        interaction layer
assets/js/terminal-frames.js  TUI strings and illustrative resume events
assets/img/jet-logo.svg  the product mark
assets/fonts/            Montserrat 300/400/500 (SIL OFL)
design/dna.json          the Design DNA profile
tools/build.py           page generator
tools/pages_*.py         page bodies
tools/                   screenshot, behaviour, edge-case, contrast harnesses
```

No build step for the site itself. Open `index.html`, or serve the directory:

```sh
python3 -m http.server 8000
```
