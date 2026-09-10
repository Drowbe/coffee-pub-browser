#!/bin/bash
# One-shot development setup for a Mac. Safe to re-run: every step skips
# what is already in place.
#
#   1. Homebrew, git, fnm (Node version manager), GitHub Desktop, VS Code
#   2. Node 22 as the default Node
#   3. ~/Developer with a clone of every Coffee Pub repository
#   4. npm install for coffee-pub-browser
#
# Run it with:
#   curl -fsSL https://raw.githubusercontent.com/Drowbe/coffee-pub-browser/main/scripts/mac-dev-setup.sh -o ~/mac-dev-setup.sh
#   bash ~/mac-dev-setup.sh
#
# Edit the REPOS list or the CASKS list below to taste before running.

set -euo pipefail

DEV_DIR="$HOME/Developer"
GITHUB_USER="Drowbe"
NODE_VERSION="22"
CASKS=(github visual-studio-code)   # GitHub Desktop, VS Code. Remove any you do not want.
REPOS=(
  coffee-pub-browser
  coffee-pub-blacksmith
  coffee-pub-merchant
  coffee-pub-regent
  coffee-pub-curator
  coffee-pub-crier
  coffee-pub-bibliosoph
  coffee-pub-librarian
  coffee-pub-cartographer
  coffee-pub-artificer
  coffee-pub-herald
  coffee-pub-squire
  coffee-pub-minstrel
  coffee-pub-monarch
  coffee-pub-scribe
  coffee-pub-vault
  coffee-pub-lib
  coffee-pub-bubo
)

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[1;32m%s\033[0m\n' "$*"; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS." >&2
  exit 1
fi

# --- Xcode Command Line Tools (git, compilers) ------------------------------
step "Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  ok "already installed"
else
  xcode-select --install || true
  echo "   A dialog opened to install the Command Line Tools. Finish it, then re-run this script."
  exit 0
fi

# --- Homebrew ---------------------------------------------------------------
step "Homebrew"
if command -v brew >/dev/null 2>&1; then
  ok "already installed"
else
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Make brew available in this shell (Apple Silicon and Intel locations).
if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
if [[ -x /usr/local/bin/brew ]]; then eval "$(/usr/local/bin/brew shellenv)"; fi
ZPROFILE="$HOME/.zprofile"
if ! grep -q 'brew shellenv' "$ZPROFILE" 2>/dev/null; then
  echo 'eval "$('"$(command -v brew)"' shellenv)"' >> "$ZPROFILE"
  ok "added Homebrew to $ZPROFILE"
fi

# --- Tools ------------------------------------------------------------------
step "Command-line tools (git, fnm)"
brew list git >/dev/null 2>&1 || brew install git
brew list fnm >/dev/null 2>&1 || brew install fnm
ok "git $(git --version | awk '{print $3}'), fnm $(fnm --version | awk '{print $2}')"

step "Apps (${CASKS[*]})"
# App bundle each cask installs, so a copy installed by hand is recognised.
app_for_cask() {
  case "$1" in
    github) echo "GitHub Desktop.app" ;;
    visual-studio-code) echo "Visual Studio Code.app" ;;
    *) echo "" ;;
  esac
}
for cask in "${CASKS[@]}"; do
  app="$(app_for_cask "$cask")"
  if brew list --cask "$cask" >/dev/null 2>&1; then
    ok "$cask already installed"
  elif [[ -n "$app" && ( -d "/Applications/$app" || -d "$HOME/Applications/$app" ) ]]; then
    ok "$cask already installed outside Homebrew ($app)"
  elif ! brew install --cask "$cask"; then
    echo "   Could not install $cask with Homebrew; install it by hand if you want it. Continuing."
  fi
done

# --- Node via fnm -----------------------------------------------------------
step "Node $NODE_VERSION via fnm"
ZSHRC="$HOME/.zshrc"
if ! grep -q 'fnm env' "$ZSHRC" 2>/dev/null; then
  printf '\n# fnm (Node version manager)\neval "$(fnm env --use-on-cd --shell zsh)"\n' >> "$ZSHRC"
  ok "added fnm to $ZSHRC"
fi
eval "$(fnm env --shell bash)"
if fnm list | grep -q "v$NODE_VERSION\."; then
  ok "Node $NODE_VERSION already installed"
else
  fnm install "$NODE_VERSION"
fi
fnm default "$NODE_VERSION"
fnm use "$NODE_VERSION"
ok "node $(node --version), npm $(npm --version)"

# --- Repositories -----------------------------------------------------------
step "Repositories in $DEV_DIR"
mkdir -p "$DEV_DIR"
for repo in "${REPOS[@]}"; do
  target="$DEV_DIR/$repo"
  if [[ -d "$target/.git" ]]; then
    ok "$repo already cloned"
  else
    git clone --quiet "https://github.com/$GITHUB_USER/$repo.git" "$target"
    ok "$repo cloned"
  fi
done

# --- coffee-pub-browser dependencies ---------------------------------------
if [[ -f "$DEV_DIR/coffee-pub-browser/package.json" ]]; then
  step "coffee-pub-browser: npm install"
  (cd "$DEV_DIR/coffee-pub-browser" && npm install --no-audit --no-fund)
  ok "ready: cd ~/Developer/coffee-pub-browser && npm start"
fi

step "Done"
cat <<MSG
   Open a new Terminal window so the shell picks up Homebrew and fnm.
   Xcode itself (for the iOS app) comes from the App Store; this script only
   installs the command-line tools.
   Sign in to GitHub Desktop once and it will list every folder in ~/Developer.
MSG
