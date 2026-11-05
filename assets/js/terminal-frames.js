// What yazi's TUI actually paints.
//
// The splash and test output come from the render code and frame goldens.
// Checkpoint and reconnect lines illustrate the example workflow:
//
//   logo   internal/tui2/app/header.go        const brandLogo
//   meta   internal/tui2/app/header_splash.go splashHeaderLines
//   steps  internal/tui2/parity/testdata/tool-call-80.txt
//
// The steps are modelled as painted elements rather than text lines, because a
// tool call is a block with a head, a command, output and an elapsed row, not
// four independent lines.
window.YAZI_TUI = {
  "logo": [
    "              :=**+:",
    "    .    .-+***+-",
    "   :=+=:-**+=.",
    ".-++=::--::",
    "-###*+:=*-:",
    ":+**+==+*=",
    "      .=+:"
  ],
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
      "text": "Checkpoint saved · rev 8"
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
      "text": "Session restored · rev 8",
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
      "time": "Took 0.0s"
    },
    {
      "kind": "assistant",
      "text": "All four scenarios passed."
    }
  ]
};
