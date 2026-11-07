// What yazi's TUI actually paints.
//
// The splash and test output come from the render code and frame goldens.
// Checkpoint and reconnect lines, and the elapsed time, illustrate the example
// workflow:
//
//   meta   internal/tui2/app/header_splash.go splashHeaderLines
//   steps  internal/tui2/parity/testdata/tool-call-80.txt
//
// The brand mark is not a string here, because in the product it is not one
// either: the header reserves a 20x7 cell box (internal/tui2/app/logo.go,
// brandCols/brandRows) and draws the artwork into it — as pixels over kitty,
// iTerm2 or sixel, as truecolor half blocks when there is colour but no image
// protocol, and as the ASCII butterfly only when there is no 24-bit colour at
// all. The mock shows the capable case, so the logo is an image in the markup
// (the .tui__logo box in index.html) and the rows below are the header's text
// rows, still verbatim.
//
// The steps are modelled as painted elements rather than text lines, because a
// tool call is a block with a head, a command, output and an elapsed row, not
// four independent lines.
window.YAZI_TUI = {
  "meta": [
    [
      "Yazi ",
      "v0.1.0-dev"
    ],
    [
      "sessions ",
      "3"
    ],
    [
      "endpoints ",
      "local"
    ],
    [
      "cwd ",
      "~/src/yazi"
    ]
  ],
  "steps": [
    {
      "kind": "user",
      "text": "Run the parity tests"
    },
    {
      "kind": "assistant",
      "text": "Preparing the test run."
    },
    {
      "kind": "event",
      "text": "Checkpoint saved"
    },
    {
      "kind": "event",
      "text": "Terminal disconnected",
      "state": "is-disconnected",
      "hold": 650
    },
    {
      "kind": "event",
      "text": "$ yazi --continue",
      "hold": 320
    },
    {
      "kind": "event",
      "text": "Session restored",
      "state": "is-resumed"
    },
    {
      "kind": "tool",
      "head": "shell · ",
      "state": "◇ running",
      "cmd": "$ go test ./internal/tui2/parity",
      "out": "",
      "time": "Elapsed 0.0s"
    },
    {
      "kind": "tool-out",
      "text": "ok  internal/tui2/parity    0.12s"
    },
    {
      "kind": "tool-done",
      "state": "done",
      "time": "Took 1.2s"
    },
    {
      "kind": "assistant",
      "text": "All four scenarios passed."
    }
  ]
};
