#!/usr/bin/env bash
# Yazi installer: clones the Yazi source, builds it, and puts it on your PATH.
#
#   curl -fsSL https://yazi.krea.to/install.sh | bash
#
# Pass options after `bash -s --`, for example:
#
#   curl -fsSL https://yazi.krea.to/install.sh | bash -s -- --ref main --yes
#   curl -fsSL https://yazi.krea.to/install.sh | bash -s -- --uninstall
#
# Run `bash install.sh --help` for every option. Re-running the installer
# updates an existing install. Nothing outside the install directory, the two
# command links, and (if you agree) one PATH line in your shell profile is
# touched. Go is not required: if it is missing or too old, a private Go
# toolchain is downloaded for the build and its checksum is verified.
#
# The whole script is wrapped in main(), which runs on the last line, so a
# download cut off halfway does nothing instead of running half an installer.

# Trap handlers and step_* functions are invoked indirectly (trap, run_step).
# shellcheck disable=SC2329

if [ -z "${BASH_VERSION:-}" ]; then
  echo "This installer needs bash. Run it with:  curl -fsSL https://yazi.krea.to/install.sh | bash" >&2
  exit 1
fi

set -euo pipefail

# ----------------------------------------------------------------------------
# Settings (flags override these environment variables)
# ----------------------------------------------------------------------------

YAZI_REPO_DEFAULT="https://src.krea.to/kreato/yazi.git"
YAZI_WEB="https://src.krea.to/kreato/yazi"
INSTALL_URL="https://yazi.krea.to/install.sh"
MODULE="src.krea.to/kreato/yazi"

REPO=${YAZI_REPO:-$YAZI_REPO_DEFAULT}
REF=${YAZI_REF:-}
INSTALL_DIR=${YAZI_INSTALL_DIR:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/yazi}
BIN_DIR=${YAZI_BIN_DIR:-${HOME:-}/.local/bin}
ASSUME_YES=${YAZI_YES:-0}
MODIFY_PATH=1
[ "${YAZI_NO_MODIFY_PATH:-0}" = 1 ] && MODIFY_PATH=0
VERBOSE=${YAZI_VERBOSE:-0}
FORCE=0
ACTION=install

PATH_MARK_BEGIN="# >>> yazi installer >>>"
PATH_MARK_END="# <<< yazi installer <<<"

# Runtime state
LOG=/dev/null
STEP_RC=0
CHILD_PID=
CURSOR_HIDDEN=0
TMP_PATHS=()
ACTIVATED=0

# ----------------------------------------------------------------------------
# Terminal output
# ----------------------------------------------------------------------------

setup_ui() {
  INTERACTIVE=0
  if [ "$ASSUME_YES" != 1 ] && { : </dev/tty; } 2>/dev/null; then
    INTERACTIVE=1
  fi

  FANCY=0
  if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ "$VERBOSE" != 1 ]; then
    FANCY=1
  fi

  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
    B=$'\033[1m' D=$'\033[2m' R=$'\033[0m'
    RED=$'\033[31m' GRN=$'\033[32m' YEL=$'\033[33m' CYN=$'\033[36m'
  else
    B='' D='' R='' RED='' GRN='' YEL='' CYN=''
  fi

  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8* | *utf-8* | *UTF8* | *utf8*)
      OK="✓" BAD="✗" WARN="!" ARROW="→" DOT="·"
      FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) ;;
    *)
      OK="ok" BAD="x" WARN="!" ARROW="->" DOT="-"
      FRAMES=('|' '/' '-' "\\") ;;
  esac
}

say()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s%s%s %s\n' "$GRN" "$OK" "$R" "$*"; }
warn() { printf '  %s%s%s %s\n' "$YEL" "$WARN" "$R" "$*" >&2; }
hint() { printf '    %s%s%s\n' "$D" "$*" "$R" >&2; }

# die "what went wrong" ["how to fix it" ...]
die() {
  printf '\n  %s%s %s%s\n' "$RED$B" "$BAD" "$1" "$R" >&2
  shift
  local line
  for line in "$@"; do hint "$line"; done
  if [ "$LOG" != /dev/null ] && [ -s "$LOG" ]; then
    hint ""
    hint "Full log: $(pretty "$LOG")"
  fi
  printf '\n' >&2
  exit 1
}

# Replace a leading $HOME with ~ for display.
pretty() {
  case "$1" in
    "$HOME") printf '~' ;;
    "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

duration() {
  local s=$1
  if [ "$s" -ge 60 ]; then printf '%dm %02ds' $((s / 60)) $((s % 60)); else printf '%ds' "$s"; fi
}

show_cursor() {
  if [ "$CURSOR_HIDDEN" = 1 ]; then printf '\033[?25h'; CURSOR_HIDDEN=0; fi
}

# ask "Question?" default(y|n) -> returns 0 for yes. Without a terminal the
# default is taken, so `curl | bash` in CI behaves like answering Enter.
ask() {
  local question=$1 default=$2 prompt answer
  if [ "$INTERACTIVE" != 1 ]; then
    [ "$default" = y ]
    return
  fi
  if [ "$default" = y ]; then prompt="[Y/n]"; else prompt="[y/N]"; fi
  while :; do
    printf '  %s%s%s %s ' "$B" "$question" "$R" "$prompt" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
    case "$answer" in
      "") [ "$default" = y ]; return ;;
      [Yy] | [Yy][Ee][Ss]) return 0 ;;
      [Nn] | [Nn][Oo]) return 1 ;;
      *) info "Please answer y or n." >/dev/tty ;;
    esac
  done
}

# run_step "Doing it|Done it" command [args...]
# Runs the command with its output in the log and a spinner on screen. The
# result is left in STEP_RC and run_step itself always succeeds: calling it
# from `if`, `||` or `&&` would make bash ignore `set -e` inside the step.
run_step() {
  local label=${1%%|*} done_label=${1#*|}
  shift
  local start=$SECONDS rc=0 i=0 pid
  printf '\n==> %s\n$ %s\n' "$label" "$*" >>"$LOG"

  if [ "$VERBOSE" = 1 ]; then
    say "  ${CYN}${ARROW}${R} $label"
    { ( "$@" ) 2>&1 | tee -a "$LOG"; } </dev/null &
  else
    ( "$@" ) >>"$LOG" 2>&1 </dev/null &
  fi
  pid=$!
  CHILD_PID=$pid

  if [ "$FANCY" = 1 ]; then
    printf '\033[?25l'
    CURSOR_HIDDEN=1
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  %s%s%s %s %s%s%s' "$CYN" "${FRAMES[i % ${#FRAMES[@]}]}" "$R" \
        "$label" "$D" "$(duration $((SECONDS - start)))" "$R"
      i=$((i + 1))
      sleep 0.1
    done
  elif [ "$VERBOSE" != 1 ]; then
    printf '  %s %s...\n' "$DOT" "$label"
  fi

  wait "$pid" || rc=$?
  CHILD_PID=
  if [ "$FANCY" = 1 ]; then printf '\r\033[K'; show_cursor; fi

  local took
  took=$(duration $((SECONDS - start)))
  STEP_RC=$rc
  if [ "$rc" -eq 0 ]; then
    printf '  %s%s%s %s %s(%s)%s\n' "$GRN" "$OK" "$R" "$done_label" "$D" "$took" "$R"
    return 0
  fi

  printf '  %s%s%s %s %s(failed after %s)%s\n' "$RED" "$BAD" "$R" "$label" "$D" "$took" "$R"
  # Failures that end in a YAZI_* marker get a specific message from the caller.
  if [ "$VERBOSE" != 1 ] && [ -s "$LOG" ] && ! tail -n 1 "$LOG" | grep -q '^YAZI_'; then
    printf '\n%s    Last lines of the log:%s\n' "$D" "$R" >&2
    tail -n 15 "$LOG" | sed 's/^/      /' >&2
  fi
  return 0
}

# ----------------------------------------------------------------------------
# Cleanup and interrupts
# ----------------------------------------------------------------------------

cleanup() {
  show_cursor
  local p
  for p in ${TMP_PATHS[@]+"${TMP_PATHS[@]}"}; do
    [ -n "$p" ] && rm -rf "$p" 2>/dev/null || :
  done
}

# Background jobs ignore SIGINT without job control, so stop the step's whole
# process tree (git, go, curl) ourselves.
kill_tree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done
  kill -TERM "$1" 2>/dev/null || :
}

on_interrupt() {
  if [ -n "$CHILD_PID" ]; then
    kill_tree "$CHILD_PID"
    wait "$CHILD_PID" 2>/dev/null || :
  fi
  show_cursor
  printf '\r\033[K\n' 2>/dev/null || :
  if [ "$ACTIVATED" = 1 ]; then
    warn "Interrupted. Yazi is installed; the remaining setup steps were skipped."
  else
    warn "Interrupted. Your existing setup was not changed."
  fi
  exit 130
}

# ----------------------------------------------------------------------------
# Arguments
# ----------------------------------------------------------------------------

usage() {
  cat <<EOF
Install Yazi from source.

Usage:
  curl -fsSL $INSTALL_URL | bash
  curl -fsSL $INSTALL_URL | bash -s -- [options]
  bash install.sh [options]

Options:
  --ref <ref>        Branch, tag or commit to build (default: the default branch)
  --dir <path>       Install directory (default: ~/.local/share/yazi)
  --bin-dir <path>   Where the yazi and yazi-runtime commands go (default: ~/.local/bin)
  --repo <url>       Git repository to clone (default: $YAZI_REPO_DEFAULT)
  -y, --yes          Don't ask questions; accept the defaults
  --no-modify-path   Never edit shell profiles
  --force            Rebuild even if this commit is already installed
  --verbose          Show build output instead of a spinner
  --uninstall        Remove Yazi (your sessions and settings are kept)
  -h, --help         Show this help

Environment:
  YAZI_REF, YAZI_INSTALL_DIR, YAZI_BIN_DIR, YAZI_REPO, YAZI_YES=1,
  YAZI_NO_MODIFY_PATH=1, YAZI_VERBOSE=1, NO_COLOR=1

Re-run the installer at any time to update.
EOF
}

need_value() {
  if [ $# -lt 2 ] || [ -z "$2" ]; then
    echo "Option $1 needs a value. See --help." >&2
    exit 2
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) need_value "$@"; REF=$2; shift 2 ;;
      --ref=*) REF=${1#*=}; shift ;;
      --dir | --install-dir) need_value "$@"; INSTALL_DIR=$2; shift 2 ;;
      --dir=* | --install-dir=*) INSTALL_DIR=${1#*=}; shift ;;
      --bin-dir) need_value "$@"; BIN_DIR=$2; shift 2 ;;
      --bin-dir=*) BIN_DIR=${1#*=}; shift ;;
      --repo) need_value "$@"; REPO=$2; shift 2 ;;
      --repo=*) REPO=${1#*=}; shift ;;
      -y | --yes) ASSUME_YES=1; shift ;;
      --no-modify-path) MODIFY_PATH=0; shift ;;
      --force) FORCE=1; shift ;;
      --verbose) VERBOSE=1; shift ;;
      --uninstall) ACTION=uninstall; shift ;;
      -h | --help) usage; exit 0 ;;
      *) echo "Unknown option: $1  (see --help)" >&2; exit 2 ;;
    esac
  done
}

# Make a user-supplied path absolute and expand a leading ~.
abspath() {
  local p=$1
  # shellcheck disable=SC2088  # matching a literal "~/" typed by the user
  case "$p" in
    "~") p=$HOME ;;
    "~/"*) p=$HOME/${p#"~/"} ;;
  esac
  case "$p" in
    /*) ;;
    *) p=$PWD/$p ;;
  esac
  # Drop trailing slashes, but keep "/" itself.
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  printf '%s' "$p"
}

# ----------------------------------------------------------------------------
# Checks
# ----------------------------------------------------------------------------

detect_platform() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    MINGW* | MSYS* | CYGWIN*)
      die "Windows isn't supported by this installer." \
        "Use WSL (https://learn.microsoft.com/windows/wsl/install) and run it there." ;;
    *) die "Unsupported operating system: $os" "Yazi supports Linux and macOS." ;;
  esac
  case "$arch" in
    x86_64 | amd64) ARCH=amd64 ;;
    arm64 | aarch64) ARCH=arm64 ;;
    *) die "Unsupported CPU architecture: $arch" "Yazi supports amd64 (x86_64) and arm64." ;;
  esac
}

package_hint() {
  # package_hint <package> -> prints an install command for this machine.
  local pkg=$1
  if [ "$OS" = darwin ]; then
    if [ "$pkg" = git ]; then
      printf 'xcode-select --install   (or: brew install git)'
    else
      printf 'brew install %s' "$pkg"
    fi
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then printf 'sudo apt-get install -y %s' "$pkg"
  elif command -v dnf >/dev/null 2>&1; then printf 'sudo dnf install -y %s' "$pkg"
  elif command -v pacman >/dev/null 2>&1; then printf 'sudo pacman -S %s' "$pkg"
  elif command -v zypper >/dev/null 2>&1; then printf 'sudo zypper install %s' "$pkg"
  elif command -v apk >/dev/null 2>&1; then printf 'sudo apk add %s' "$pkg"
  else printf 'install %s with your package manager' "$pkg"
  fi
}

check_tools() {
  local missing=() t
  for t in git curl tar; do
    command -v "$t" >/dev/null 2>&1 || missing+=("$t")
  done
  # On macOS /usr/bin/git exists before the developer tools do, and fails.
  if command -v git >/dev/null 2>&1 && ! git --version >/dev/null 2>&1; then
    missing+=(git)
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    local lines=() m
    for m in "${missing[@]}"; do lines+=("$m:  $(package_hint "$m")"); done
    die "Missing required tools: ${missing[*]}" "${lines[@]}" "" "Then run the installer again."
  fi
  if command -v sha256sum >/dev/null 2>&1; then SHA256="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then SHA256="shasum -a 256"
  elif command -v openssl >/dev/null 2>&1; then SHA256="openssl-sha256"
  else SHA256=""
  fi
}

sha256_of() {
  if [ "$SHA256" = openssl-sha256 ]; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    $SHA256 "$1" | awk '{print $1}'
  fi
}

check_root() {
  if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
    warn "You're running the installer with sudo, so Yazi would be installed for root only."
    hint "Yazi installs into your home directory and doesn't need sudo."
    ask "Install for root anyway?" n || die "Cancelled." "Run it again without sudo:  curl -fsSL $INSTALL_URL | bash"
  fi
}

# The install dir must look like ours before we delete anything in it.
looks_like_install_dir() {
  local d=$1
  case "$d" in "" | / | "$HOME" | "$HOME/") return 1 ;; esac
  [ -f "$d/.yazi-installer" ] && return 0
  # Release-installer layout: current -> versions/<v>, holding our binaries.
  [ -L "$d/current" ] && [ -f "$d/current/yazi" ] && [ -f "$d/current/yazi-runtime" ] || return 1
  case "$(readlink "$d/current")" in versions/?* | "$d"/versions/?*) return 0 ;; esac
  return 1
}

# Is $1 a link that we (or the release installer) made?
is_our_link() {
  [ -L "$1" ] || return 1
  local target
  target=$(readlink "$1")
  case "$target" in "$INSTALL_DIR"/*) return 0 ;; esac
  return 1
}

check_links_free() {
  local name path
  for name in yazi yazi-runtime; do
    path=$BIN_DIR/$name
    if { [ -e "$path" ] || [ -L "$path" ]; } && ! is_our_link "$path"; then
      local what="another program"
      [ "$name" = yazi ] && what="another program (perhaps the Yazi file manager)"
      die "$(pretty "$path") already exists and belongs to $what." \
        "The installer won't overwrite it. Pick another directory for the commands:" \
        "  curl -fsSL $INSTALL_URL | bash -s -- --bin-dir ~/.yazi/bin"
    fi
  done
}

# ----------------------------------------------------------------------------
# Version helpers
# ----------------------------------------------------------------------------

# Splits "go1.26.7", "1.26", "go1.27rc1" into "MAJOR MINOR PATCH"; a
# pre-release sorts before the .0 release.
go_triplet() {
  local v=${1#go} major minor patch rest
  major=${v%%.*}
  rest=${v#*.}
  [ "$rest" = "$v" ] && rest=0
  minor=${rest%%.*}
  if [ "$rest" = "$minor" ]; then patch=0; else patch=${rest#*.}; patch=${patch%%[!0-9]*}; fi
  case "$minor" in
    *[!0-9]*) minor=${minor%%[!0-9]*}; patch=-1 ;;
  esac
  printf '%s %s %s' "${major:-0}" "${minor:-0}" "${patch:-0}"
}

# version_ge A B -> A >= B
version_ge() {
  local a1 a2 a3 b1 b2 b3
  read -r a1 a2 a3 <<<"$(go_triplet "$1")"
  read -r b1 b2 b3 <<<"$(go_triplet "$2")"
  [ "$a1" -ne "$b1" ] && { [ "$a1" -gt "$b1" ]; return; }
  [ "$a2" -ne "$b2" ] && { [ "$a2" -gt "$b2" ]; return; }
  [ "$a3" -ge "$b3" ]
}

same_minor() {
  local a b
  a=$(go_triplet "$1"); b=$(go_triplet "$2")
  [ "${a% *}" = "${b% *}" ]
}

system_go_version() {
  command -v go >/dev/null 2>&1 || return 1
  local v
  v=$(GOTOOLCHAIN=local go env GOVERSION 2>/dev/null) || return 1
  case "$v" in go[0-9]*) printf '%s' "${v%% *}" ;; *) return 1 ;; esac
}

# ----------------------------------------------------------------------------
# Install steps (each runs under run_step, in a subshell)
# ----------------------------------------------------------------------------

step_fetch_source() {
  # Never prompt for credentials under the spinner; fail instead.
  export GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never
  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
  if [ ! -d "$SRC/.git" ]; then
    rm -rf "$SRC"
    git init -q "$SRC"
    git -C "$SRC" remote add origin "$REPO"
  else
    git -C "$SRC" remote set-url origin "$REPO"
  fi
  git -C "$SRC" config advice.detachedHead false

  local want=${REF:-HEAD} commit=""
  if git -C "$SRC" fetch --depth 1 --no-tags origin "$want"; then
    commit=$(git -C "$SRC" rev-parse FETCH_HEAD)
  else
    # Some servers refuse a shallow fetch of a bare commit id: fetch everything.
    echo "Shallow fetch of '$want' failed; fetching full history."
    if [ -f "$SRC/.git/shallow" ]; then
      git -C "$SRC" fetch --unshallow --tags origin '+refs/heads/*:refs/remotes/origin/*'
    else
      git -C "$SRC" fetch --tags origin '+refs/heads/*:refs/remotes/origin/*'
    fi
    local c
    for c in "origin/$want" "refs/tags/$want" "$want"; do
      if commit=$(git -C "$SRC" rev-parse --verify --quiet "$c^{commit}"); then break; fi
      commit=""
    done
    if [ -z "$commit" ]; then
      echo "YAZI_REF_NOT_FOUND"
      exit 3
    fi
  fi
  git -C "$SRC" checkout -q -f --detach "$commit"
  git -C "$SRC" clean -qfdx
  # If the ref was a tag, fetch it too so the version can be named after it.
  if [ -n "$REF" ]; then
    git -C "$SRC" fetch -q --depth 1 --no-tags origin "+refs/tags/$REF:refs/tags/$REF" 2>/dev/null || :
  fi
}

step_download_go() {
  local file=$GO_WANT.$OS-$ARCH.tar.gz dest=$TOOLCHAINS/$GO_WANT
  local tmp=$GO_TMP
  rm -rf "$tmp"
  mkdir -p "$tmp"
  curl -fsSL --retry 3 -o "$tmp/$file" "https://dl.google.com/go/$file"
  local want_sum=$GO_SHA got_sum
  if [ -z "$want_sum" ]; then
    want_sum=$(curl -fsSL --retry 3 "https://dl.google.com/go/$file.sha256" | awk '{print $1}')
  fi
  got_sum=$(sha256_of "$tmp/$file")
  echo "expected sha256 $want_sum"
  echo "actual   sha256 $got_sum"
  if [ -z "$want_sum" ] || [ "$want_sum" != "$got_sum" ]; then
    echo "YAZI_CHECKSUM_MISMATCH"
    rm -rf "$tmp"
    exit 4
  fi
  tar -xzf "$tmp/$file" -C "$tmp"
  rm -f "$tmp/$file"
  rm -rf "$dest"
  mv "$tmp" "$dest"
}

step_go_mod_download() {
  cd "$SRC"
  "$GO" mod download -x
}

step_build() {
  # step_build <cmd name> <output dir>
  cd "$SRC"
  CGO_ENABLED=0 "$GO" build -trimpath \
    -ldflags "-s -w -X $MODULE/internal/buildinfo.Version=$VERSION" \
    -o "$2/$1" "./cmd/$1"
}

# ----------------------------------------------------------------------------
# Go toolchain selection
# ----------------------------------------------------------------------------

required_go() {
  awk '$1 == "go" { print $2; exit }' "$SRC/go.mod"
}

# Choose a Go release to download for minimum version $1. Prefers the newest
# patch of the same minor release, then any newer stable release. Sets GO_WANT
# and GO_SHA (empty when the checksum must come from dl.google.com).
pick_go_download() {
  local need=$1 json versions v
  GO_WANT="" GO_SHA=""
  json=$(curl -fsSL --retry 3 "https://go.dev/dl/?mode=json" 2>>"$LOG") || json=""
  versions=$(printf '%s\n' "$json" | sed -n 's/^ *"version": *"\(go[0-9][^"]*\)".*/\1/p' | awk '!seen[$0]++')
  for v in $versions; do
    if same_minor "$v" "go$need" && version_ge "$v" "go$need"; then GO_WANT=$v; break; fi
  done
  if [ -z "$GO_WANT" ]; then
    for v in $versions; do
      if version_ge "$v" "go$need"; then GO_WANT=$v; break; fi
    done
  fi
  if [ -z "$GO_WANT" ]; then
    # go.dev was unreachable: fall back to the exact minimum release.
    [ -n "$json" ] && NO_STABLE_GO=1
    GO_WANT=go$need
    case "$need" in *.*.* | *rc* | *beta*) ;; *.*) GO_WANT=go$need.0 ;; esac
  fi
  local file=$GO_WANT.$OS-$ARCH.tar.gz
  GO_SHA=$(printf '%s\n' "$json" | awk -v f="$file" '
    index($0, "\"filename\": \"" f "\"") { hit = 1; next }
    hit && /"sha256":/ { gsub(/.*"sha256": *"|".*/, ""); print; exit }
    hit && /"filename":/ { exit }')
}

choose_go() {
  local need sys
  need=$(required_go 2>/dev/null) || need=""
  [ -f "$SRC/go.mod" ] || die "The repository has no go.mod, so it isn't Yazi's source." "Check --repo: $REPO"
  [ -n "$need" ] || need=1.21

  if sys=$(system_go_version) && version_ge "$sys" "go$need"; then
    GO=$(command -v go)
    GO_LABEL="$sys ($(pretty "$GO"))"
    GO_PRIVATE=0
    return
  fi

  # Reuse a toolchain from an earlier run if it is new enough.
  local d
  for d in "$TOOLCHAINS"/go*; do
    [ -x "$d/go/bin/go" ] || continue
    if version_ge "$(basename "$d")" "go$need"; then
      GO=$d/go/bin/go
      GO_LABEL="$(basename "$d") (private copy)"
      GO_PRIVATE=1
      return
    fi
  done

  if [ -z "${sys:-}" ] && command -v go >/dev/null 2>&1; then
    info "Your Go ($(pretty "$(command -v go)")) didn't report a release version; using a private copy."
  elif [ -n "${sys:-}" ]; then
    info "Your Go is $sys; this version of Yazi needs go$need or newer."
  else
    info "Go isn't installed; that's fine."
  fi
  NO_STABLE_GO=0
  pick_go_download "$need"
  if [ "$NO_STABLE_GO" = 1 ]; then
    die "This version of Yazi needs Go $need, which go.dev doesn't offer as a stable release yet." \
      "Install that Go yourself (https://go.dev/dl/) and run the installer again."
  fi
  if [ -z "$SHA256" ]; then
    die "Can't verify the Go download: no sha256sum, shasum or openssl found." \
      "Install Go $need or newer yourself (https://go.dev/dl/) and run the installer again."
  fi
  info "The installer will download $GO_WANT (about 70 MB) to $(pretty "$TOOLCHAINS")."
  info "${D}It's only used to build Yazi and is removed when you uninstall.${R}"
  ask "Download Go?" y ||
    die "Cancelled." "Install Go $need or newer (https://go.dev/dl/) and run the installer again."

  mkdir -p "$TOOLCHAINS"
  GO_TMP=$TOOLCHAINS/.download
  TMP_PATHS+=("$GO_TMP")
  run_step "Downloading $GO_WANT|Downloaded and verified $GO_WANT" step_download_go
  if [ "$STEP_RC" -ne 0 ]; then
    if grep -q YAZI_CHECKSUM_MISMATCH "$LOG"; then
      die "The Go download didn't match its published checksum, so it was discarded." \
        "This is usually a broken proxy or a truncated download. Try again."
    fi
    die "Couldn't download Go." "Check your internet connection, or install Go $need+ from https://go.dev/dl/."
  fi
  GO=$TOOLCHAINS/$GO_WANT/go/bin/go
  GO_LABEL="$GO_WANT (private copy)"
  GO_PRIVATE=1
}

# ----------------------------------------------------------------------------
# PATH
# ----------------------------------------------------------------------------

on_path() {
  case ":$PATH:" in *":$1:"*) return 0 ;; esac
  return 1
}

# Prints the profile file to edit for the user's login shell.
profile_file() {
  case "$(basename "${SHELL:-}")" in
    zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$OS" = darwin ]; then
        # Login bash reads only the first of these that exists.
        local f
        for f in .bash_profile .bash_login .profile; do
          if [ -f "$HOME/$f" ]; then printf '%s' "$HOME/$f"; return; fi
        done
        printf '%s' "$HOME/.bash_profile"
      else
        printf '%s' "$HOME/.bashrc"
      fi ;;
    fish) printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/yazi-installer-path.fish" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

path_line() {
  local dir=$1 shown
  # Write $HOME rather than the expanded path, so the profile stays portable.
  case "$dir" in "$HOME"/*) shown="\$HOME${dir#"$HOME"}" ;; *) shown=$dir ;; esac
  if [ "${2:-}" = fish ]; then
    printf 'fish_add_path -g "%s"' "$shown"
  else
    # shellcheck disable=SC2016  # $PATH is meant to stay literal
    printf 'export PATH="%s:$PATH"' "$shown"
  fi
}

PATH_RESULT=""
PATH_FILE=""
PATH_KIND="sh"
setup_path() {
  if on_path "$BIN_DIR"; then
    PATH_RESULT=already
    return
  fi
  local file kind=sh
  file=$(profile_file)
  case "$file" in *.fish) kind=fish ;; esac
  PATH_KIND=$kind

  if [ -f "$file" ] && grep -qF "$(path_line "$BIN_DIR" "$kind")" "$file"; then
    PATH_RESULT=profile-has-it
    PATH_FILE=$file
    return
  fi
  if [ "$MODIFY_PATH" != 1 ]; then
    PATH_RESULT=manual
    PATH_FILE=$file
    return
  fi
  PATH_FILE=$file
  if { [ -e "$file" ] && [ ! -w "$file" ]; } || ! mkdir -p "$(dirname "$file")" 2>/dev/null; then
    say ""
    warn "$(pretty "$file") isn't writable (managed by home-manager or similar?), so PATH wasn't changed."
    PATH_RESULT=manual
    return
  fi
  say ""
  info "$(pretty "$BIN_DIR") isn't on your PATH yet, so your shell won't find ${B}yazi${R}."
  if ! ask "Add it to $(pretty "$file")?" y; then
    PATH_RESULT=manual
    return
  fi
  if ! {
    printf '\n%s\n' "$PATH_MARK_BEGIN"
    path_line "$BIN_DIR" "$kind"
    printf '\n%s\n' "$PATH_MARK_END"
  } 2>/dev/null >>"$file"; then
    warn "Couldn't write to $(pretty "$file"), so PATH wasn't changed."
    PATH_RESULT=manual
    return
  fi
  ok "Added $(pretty "$BIN_DIR") to PATH in $(pretty "$file")"
  PATH_RESULT=added
  PATH_FILE=$file
}

# Warn when another `yazi` earlier on PATH would win over ours.
check_shadowing() {
  # Only matters when the bin dir is already on PATH; a line we add puts it first.
  on_path "$BIN_DIR" || return 0
  local dir found=""
  local IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    [ "$dir" = "$BIN_DIR" ] && break
    if [ -x "$dir/yazi" ] && ! is_our_link "$dir/yazi"; then found=$dir/yazi; break; fi
  done
  unset IFS
  if [ -n "$found" ]; then
    say ""
    warn "Another ${B}yazi${R} at $(pretty "$found") comes first on your PATH."
    hint "It's probably the Yazi file manager. To use this Yazi, put $(pretty "$BIN_DIR")"
    hint "earlier in PATH, or run it as $(pretty "$BIN_DIR")/yazi."
  fi
}

# ----------------------------------------------------------------------------
# Install
# ----------------------------------------------------------------------------

install_yazi() {
  SRC=$INSTALL_DIR/src
  TOOLCHAINS=$INSTALL_DIR/toolchain

  say ""
  say "  ${B}Yazi installer${R}  ${D}builds Yazi from source${R}"
  say ""

  check_tools
  check_root
  check_links_free

  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ] &&
    ! looks_like_install_dir "$INSTALL_DIR"; then
    die "$(pretty "$INSTALL_DIR") already exists and isn't a Yazi install." \
      "The installer needs a directory of its own (uninstall deletes it)." \
      "Pick a new or empty one with --dir."
  fi

  if [ -e "$INSTALL_DIR/.activation.json" ] || { [ -d "$INSTALL_DIR/current" ] && [ ! -L "$INSTALL_DIR/current" ]; }; then
    die "$(pretty "$INSTALL_DIR") is managed by 'yazi update'." \
      "Keep using 'yazi update', or install from source into another directory with --dir."
  fi

  local previous="" sys=""
  if [ -L "$INSTALL_DIR/current" ]; then
    previous=$(basename "$(readlink "$INSTALL_DIR/current")")
  fi

  local go_plan
  if sys=$(system_go_version); then
    go_plan="$sys at $(pretty "$(command -v go)") (a private copy is fetched if it's too old)"
  else
    go_plan="not installed: a private copy is downloaded for the build"
  fi

  info "${D}Source  ${R} $YAZI_WEB ${D}${REF:-default branch}${R}"
  [ "$REPO" != "$YAZI_REPO_DEFAULT" ] && info "${D}Repo    ${R} $REPO"
  info "${D}Install ${R} $(pretty "$INSTALL_DIR")"
  info "${D}Commands${R} $(pretty "$BIN_DIR")/yazi, $(pretty "$BIN_DIR")/yazi-runtime"
  info "${D}Go      ${R} $go_plan"
  if [ -n "$previous" ]; then
    info "${D}Current ${R} $previous ${D}(updated if there's anything newer)${R}"
  fi
  say ""
  ask "Continue?" y || die "Cancelled. Nothing was changed."
  [ "$INTERACTIVE" = 1 ] && say ""

  mkdir -p "$INSTALL_DIR" "$BIN_DIR" ||
    die "Couldn't create $(pretty "$INSTALL_DIR") or $(pretty "$BIN_DIR")." "Check the permissions, or choose others with --dir and --bin-dir."
  : >"$INSTALL_DIR/.yazi-installer"
  LOG=$INSTALL_DIR/install.log
  {
    echo "Yazi installer log, $(date)"
    echo "repo=$REPO ref=${REF:-HEAD} dir=$INSTALL_DIR bin=$BIN_DIR os=$OS arch=$ARCH"
  } >"$LOG"

  # 1. Source
  run_step "Fetching the source|Fetched the source" step_fetch_source
  if [ "$STEP_RC" -ne 0 ]; then
    if grep -q YAZI_REF_NOT_FOUND "$LOG"; then
      die "There's no branch, tag or commit called '$REF' in the repository." \
        "Browse them at $YAZI_WEB, or leave out --ref to use the default branch."
    fi
    die "Couldn't download the source from $REPO." \
      "Check your internet connection and that $YAZI_WEB opens in a browser."
  fi

  local commit short subject base=""
  commit=$(git -C "$SRC" rev-parse HEAD)
  short=$(git -C "$SRC" rev-parse --short=7 HEAD)
  subject=$(git -C "$SRC" log -1 --format='%s' HEAD 2>/dev/null | cut -c1-60) || subject=""
  subject="$subject ($(git -C "$SRC" log -1 --format='%cr' HEAD 2>/dev/null))"
  info "${D}$short $subject${R}"

  if VERSION=$(git -C "$SRC" describe --tags --exact-match 2>/dev/null); then
    VERSION=${VERSION#v}
  else
    base=$(sed -n 's/^var Version = "\(.*\)"$/\1/p' "$SRC/internal/buildinfo/version.go" 2>/dev/null | head -n 1)
    VERSION=${base:-0.0.0-dev}+$short
  fi
  # The version names a directory: keep it to one safe path component.
  case "$VERSION" in
    */* | .* | *[!A-Za-z0-9._+-]*) VERSION=${base:-0.0.0-dev}+$short ;;
  esac
  echo "commit=$commit version=$VERSION" >>"$LOG"

  local dest=$INSTALL_DIR/versions/$VERSION
  if [ "$FORCE" != 1 ] && [ "$previous" = "$VERSION" ] &&
    [ -x "$dest/yazi" ] && [ -x "$dest/yazi-runtime" ]; then
    ok "Yazi $VERSION is already installed and up to date"
    hint "Run with --force to rebuild it anyway."
  else
    build_and_activate "$dest" "$previous"
  fi

  link_commands
  setup_path
  check_shadowing
  finish "$previous"
}

build_and_activate() {
  local dest=$1 previous=$2 rc=0

  # 2. Go
  choose_go
  ok "Using $GO_LABEL"
  export GOTOOLCHAIN=local GOFLAGS="${GOFLAGS:-}" GOWORK=off
  unset GOOS GOARCH GOBIN
  if [ "$GO_PRIVATE" = 1 ]; then
    unset GOROOT
    # Keep the private toolchain's caches inside the install dir, writable so
    # uninstall can delete them.
    export GOPATH=$INSTALL_DIR/gopath GOCACHE=$INSTALL_DIR/cache/go-build
    export GOFLAGS="$GOFLAGS -modcacherw"
  fi

  # 3. Dependencies and build
  run_step "Downloading Go modules|Downloaded Go modules" step_go_mod_download
  [ "$STEP_RC" = 0 ] || die "Couldn't download Yazi's Go dependencies." \
      "Check your internet connection. Behind a proxy, set HTTPS_PROXY or GOPROXY and try again."

  local stage=$dest.partial
  TMP_PATHS+=("$stage")
  rm -rf "$stage"
  mkdir -p "$stage"

  [ "$FANCY" = 1 ] && [ -z "$previous" ] && info "${D}The first build takes a minute or two.${R}"
  run_step "Building yazi|Built yazi" step_build yazi "$stage"
  [ "$STEP_RC" = 0 ] || die "The build failed." "This commit may be broken. Try a known-good version with --ref <tag>," \
      "and please report it at $YAZI_WEB/issues with the log attached."
  run_step "Building yazi-runtime|Built yazi-runtime" step_build yazi-runtime "$stage"
  [ "$STEP_RC" = 0 ] || die "The build failed." "This commit may be broken. Try a known-good version with --ref <tag>," \
      "and please report it at $YAZI_WEB/issues with the log attached."

  # 4. Smoke test before switching anything over
  local reported
  reported=$(YAZI_RUNTIME="$stage/yazi-runtime" "$stage/yazi" version 2>>"$LOG") || reported=""
  if [ "$reported" != "$VERSION" ]; then
    die "The new build doesn't run (it reported '${reported:-nothing}')." \
      "Your existing install was left as it was."
  fi
  reported=$("$stage/yazi-runtime" version </dev/null 2>>"$LOG") || reported=""
  if [ "$reported" != "$VERSION" ]; then
    die "The new yazi-runtime doesn't run (it reported '${reported:-nothing}')." \
      "Your existing install was left as it was."
  fi
  ok "Checked the build: yazi $VERSION starts"
  [ -f "$SRC/CHANGELOG.md" ] && cp "$SRC/CHANGELOG.md" "$stage/" || :

  # 5. Activate: swap the version dir in, then repoint `current`.
  rm -rf "$dest"
  mv "$stage" "$dest"
  # -n replaces the link itself instead of following it into the old version.
  [ -L "$INSTALL_DIR/current" ] || rm -rf "$INSTALL_DIR/current"
  ln -sfn "versions/$VERSION" "$INSTALL_DIR/current"
  ACTIVATED=1

  # 6. Keep the new version and the one before it (for rollback); drop the rest.
  local v
  for v in "$INSTALL_DIR"/versions/*; do
    [ -d "$v" ] || continue
    case "$(basename "$v")" in "$VERSION" | "$previous") ;; *) rm -rf "$v" ;; esac
  done
  if [ "$GO_PRIVATE" = 1 ]; then
    for v in "$TOOLCHAINS"/go*; do
      [ "$v/go/bin/go" = "$GO" ] || rm -rf "$v"
    done
  fi
}

link_commands() {
  local name
  for name in yazi yazi-runtime; do
    ln -sfn "$INSTALL_DIR/current/$name" "$BIN_DIR/$name"
  done
  ok "Linked yazi and yazi-runtime into $(pretty "$BIN_DIR")"
}

finish() {
  local previous=$1
  say ""
  if [ -n "$previous" ] && [ "$previous" != "$VERSION" ]; then
    say "  ${GRN}${B}Yazi is updated${R}  ${D}$previous ${ARROW}${R} ${B}$VERSION${R}"
    hint "If Yazi was running, run 'yazi shutdown' so the background service restarts on the new version."
  else
    say "  ${GRN}${B}Yazi $VERSION is installed.${R}"
  fi
  say ""

  case "$PATH_RESULT" in
    added | profile-has-it)
      info "Open a new terminal, or run this to use it right away:"
      info "  ${CYN}$(path_line "$BIN_DIR" "$PATH_KIND")${R}"
      say "" ;;
    manual)
      info "Add $(pretty "$BIN_DIR") to your PATH to run ${B}yazi${R} by name:"
      info "  ${CYN}$(path_line "$BIN_DIR" "$PATH_KIND")${R}"
      info "${D}(add that line to $(pretty "$PATH_FILE") to make it permanent)${R}"
      say "" ;;
  esac

  info "${B}Get started${R}"
  info "  ${CYN}yazi${R}                ${D}start Yazi, then type /login to connect a provider${R}"
  info "  ${CYN}yazi -p \"Reply with the words Yazi is ready.\"${R}"
  info "  ${CYN}yazi doctor${R}         ${D}if something doesn't work${R}"
  say ""
  info "${D}Update: run the same install command again.${R}"
  local extra=""
  [ "$INSTALL_DIR" = "${XDG_DATA_HOME:-$HOME/.local/share}/yazi" ] || extra=" --dir $(pretty "$INSTALL_DIR")"
  [ "$BIN_DIR" = "$HOME/.local/bin" ] || extra="$extra --bin-dir $(pretty "$BIN_DIR")"
  info "${D}Remove: curl -fsSL $INSTALL_URL | bash -s -- --uninstall$extra${R}"
  say ""
}

# ----------------------------------------------------------------------------
# Uninstall
# ----------------------------------------------------------------------------

remove_path_block() {
  local file=$1 tmp
  [ -f "$file" ] && [ -w "$file" ] && grep -qF "$PATH_MARK_BEGIN" "$file" || return 1
  tmp=$(mktemp "${TMPDIR:-/tmp}/yazi-profile.XXXXXX") || return 1
  # Drops BEGIN..END blocks and the blank line setup_path writes before one;
  # keeps a block whose END is missing; tolerates CRLF.
  if awk -v b="$PATH_MARK_BEGIN" -v e="$PATH_MARK_END" '
      { l = $0; sub(/\r$/, "", l) }
      !skip && l == b { skip = 1; buf = $0 "\n"; next }
      skip { buf = buf $0 "\n"; if (l == e) { skip = 0; buf = ""; held = "" }; next }
      held != "" { printf "%s", held; held = "" }
      l == "" { held = $0 "\n"; next }
      { print }
      END { printf "%s", held; if (skip) printf "%s", buf }' "$file" >"$tmp" &&
    ! grep -qF "$PATH_MARK_BEGIN" "$tmp"; then
    # Write through, so symlinked dotfiles and the file's mode are kept.
    cat "$tmp" >"$file"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

uninstall_yazi() {
  say ""
  say "  ${B}Uninstall Yazi${R}"
  say ""

  local have_dir=0 name f
  looks_like_install_dir "$INSTALL_DIR" && have_dir=1
  local links=()
  for name in yazi yazi-runtime; do
    is_our_link "$BIN_DIR/$name" && links+=("$BIN_DIR/$name")
  done
  local profiles=() candidates
  candidates="$HOME/.zshrc:$HOME/.bashrc:$HOME/.bash_profile:$HOME/.bash_login:$HOME/.profile"
  candidates="$candidates:${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/yazi-installer-path.fish"
  if [ -n "${ZDOTDIR:-}" ] && [ "$ZDOTDIR" != "$HOME" ]; then candidates="$ZDOTDIR/.zshrc:$candidates"; fi
  local IFS=:
  for f in $candidates; do
    if [ -f "$f" ] && grep -qF "$PATH_MARK_BEGIN" "$f"; then profiles+=("$f"); fi
  done
  unset IFS

  if [ "$have_dir" = 0 ] && [ ${#links[@]} -eq 0 ] && [ ${#profiles[@]} -eq 0 ]; then
    if [ -d "$INSTALL_DIR" ]; then
      die "$(pretty "$INSTALL_DIR") doesn't look like a Yazi install, so it was left alone."
    fi
    ok "Yazi isn't installed at $(pretty "$INSTALL_DIR"). Nothing to do."
    say ""
    return
  fi

  info "This removes:"
  [ "$have_dir" = 1 ] && info "  $(pretty "$INSTALL_DIR")  ${D}(program, source checkout, build caches)${R}"
  for f in ${links[@]+"${links[@]}"}; do info "  $(pretty "$f")"; done
  for f in ${profiles[@]+"${profiles[@]}"}; do info "  the PATH line in $(pretty "$f")"; done
  say ""
  info "${D}Your sessions, settings and keys in $(pretty "${XDG_STATE_HOME:-$HOME/.local/state}/yazi") are kept.${R}"
  say ""
  ask "Uninstall Yazi?" y || die "Cancelled. Nothing was changed."
  say ""

  # Stop the background service so nothing keeps running a deleted binary.
  if [ -x "$INSTALL_DIR/current/yazi" ]; then
    ("$INSTALL_DIR/current/yazi" shutdown </dev/null >/dev/null 2>&1 &
      p=$!
      ( sleep 10; kill "$p" 2>/dev/null ) >/dev/null 2>&1 &
      wait "$p" 2>/dev/null) || :
  fi

  for f in ${links[@]+"${links[@]}"}; do rm -f "$f"; done
  [ ${#links[@]} -gt 0 ] && ok "Removed the yazi commands from $(pretty "$BIN_DIR")"
  for f in ${profiles[@]+"${profiles[@]}"}; do
    if remove_path_block "$f"; then
      ok "Removed the PATH line from $(pretty "$f")"
      # Our own fish snippet: drop the file once it's empty.
      case "$f" in *yazi-installer-path.fish) grep -q '[^[:space:]]' "$f" || rm -f "$f" ;; esac
    else
      warn "Couldn't edit $(pretty "$f"); delete its '$PATH_MARK_BEGIN' block yourself."
    fi
  done
  if [ "$have_dir" = 1 ]; then
    # Delete only what the installers create, then the directory if it's empty.
    local e
    for e in versions current src toolchain gopath cache downloads install.log .yazi-installer; do
      [ -e "$INSTALL_DIR/$e" ] || [ -L "$INSTALL_DIR/$e" ] || continue
      # The Go module cache is read-only by default.
      [ -L "$INSTALL_DIR/$e" ] || chmod -R u+w "$INSTALL_DIR/$e" 2>/dev/null || :
      rm -rf "${INSTALL_DIR:?}/$e"
    done
    if rmdir "$INSTALL_DIR" 2>/dev/null; then
      ok "Removed $(pretty "$INSTALL_DIR")"
    else
      warn "Kept $(pretty "$INSTALL_DIR"): it has files the installer didn't create."
    fi
  fi
  say ""
  say "  ${B}Yazi is uninstalled.${R} ${D}Thanks for trying it.${R}"
  info "${D}To delete your sessions and settings too: rm -rf $(pretty "${XDG_STATE_HOME:-$HOME/.local/state}/yazi")${R}"
  say ""
}

# ----------------------------------------------------------------------------

main() {
  parse_args "$@"
  setup_ui
  case "$REF" in -*) die "Invalid --ref: $REF" ;; esac
  trap cleanup EXIT
  trap on_interrupt INT TERM

  [ -n "${HOME:-}" ] || die "HOME isn't set." "The installer installs into your home directory."
  HOME=$(abspath "$HOME")
  INSTALL_DIR=$(abspath "$INSTALL_DIR")
  BIN_DIR=$(abspath "$BIN_DIR")
  [ "$INSTALL_DIR" != "$BIN_DIR" ] || die "--dir and --bin-dir must be different directories."
  case "$INSTALL_DIR" in / | "$HOME") die "Refusing to use $INSTALL_DIR as the install directory." "Choose a dedicated directory with --dir." ;; esac

  detect_platform
  if [ "$ACTION" = uninstall ]; then
    uninstall_yazi
  else
    install_yazi
  fi
}

# `exit` stops bash from reading anything appended to this file mid-run.
main "$@"
exit "$?"
