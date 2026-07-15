#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Foliantica — Linux / macOS first-time setup
#
# Checks prerequisites, lets you choose a PostgreSQL mode, validates or
# creates the DB user/database, and saves the preference so
# LaunchFoliantica.sh picks it up automatically on every start.
#
# Usage:
#   ./install.sh                   — interactive (prompts for PG mode)
#   ./install.sh --pg=system       — system PostgreSQL (port 5432)
#   ./install.sh --pg=docker       — Docker Compose PostgreSQL (port 15434)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RESET="\033[0m"; BOLD="\033[1m"; CYAN="\033[96m"
  GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"
  GRAY="\033[90m"; WHITE="\033[97m"
else
  RESET="" BOLD="" CYAN="" GREEN="" YELLOW="" RED="" GRAY="" WHITE=""
fi

ok()   { echo -e "  ${GREEN}[ok]${RESET}    $*"; }
err()  { echo -e "  ${RED}[error]${RESET} $*" >&2; }
warn() { echo -e "  ${YELLOW}[warn]${RESET}  $*"; }
step() { echo -e "\n  ${BOLD}${WHITE}$*${RESET}"; }
info() { echo -e "  ${GRAY}$*${RESET}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOLIANTICA_DIR="$HOME/.foliantica"
CONFIG_FILE="$FOLIANTICA_DIR/config.json"

# ── Argument parsing ──────────────────────────────────────────────────────────
PG_FLAG=""
PG_HOST="127.0.0.1"
PG_PORT=""
PG_USER="foliantica"
PG_PASS="foliantica"
PG_DB="foliantica"

for arg in "$@"; do
  case "$arg" in
    --pg=*)         PG_FLAG="${arg#--pg=}" ;;
    --pg-port=*)    PG_PORT="${arg#--pg-port=}" ;;
    --pg-user=*)    PG_USER="${arg#--pg-user=}" ;;
    --pg-pass=*)    PG_PASS="${arg#--pg-pass=}" ;;
    --pg-db=*)      PG_DB="${arg#--pg-db=}" ;;
    --help|-h)
      echo
      echo -e "  ${BOLD}${CYAN}Foliantica${RESET}  —  First-time setup"
      echo
      echo -e "  ${WHITE}Usage:${RESET}  ${YELLOW}./install.sh${RESET} ${GRAY}[--pg=system|docker] [options]${RESET}"
      echo
      echo -e "  ${WHITE}PostgreSQL options:${RESET}"
      echo -e "    ${YELLOW}--pg=system${RESET}      Use installed system PostgreSQL  (default port 5432)"
      echo -e "    ${YELLOW}--pg=docker${RESET}      Use Docker Compose PostgreSQL    (port 15434)"
      echo
      echo -e "  ${WHITE}Connection overrides:${RESET}"
      echo -e "    ${YELLOW}--pg-port=5432${RESET}   PostgreSQL port"
      echo -e "    ${YELLOW}--pg-user=NAME${RESET}   PostgreSQL username"
      echo -e "    ${YELLOW}--pg-pass=PASS${RESET}   PostgreSQL password"
      echo -e "    ${YELLOW}--pg-db=NAME${RESET}     PostgreSQL database name"
      echo
      exit 0
      ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo
echo -e "  ${BOLD}${CYAN}Foliantica${RESET}  —  Setup"
echo -e "  ${GRAY}----------------------------------------------${RESET}"
echo

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"

_missing=0

# Detect apt-based distro (Debian, Ubuntu, etc.)
_HAS_APT=0
command -v apt-get &>/dev/null && _HAS_APT=1

# ── curl ─────────────────────────────────────────────────────────────────────
# Needed to install uv and for the health-check in the launcher.
if ! command -v curl &>/dev/null; then
  if [[ "$_HAS_APT" -eq 1 ]]; then
    info "curl not found — installing via apt..."
    sudo apt-get install -y curl
    ok "curl installed."
  else
    err "curl not found — required to install uv."
    info "Install curl (e.g. brew install curl) and re-run."
    exit 1
  fi
else
  ok "curl $(curl --version 2>/dev/null | awk 'NR==1{print $1,$2}')"
fi

# ── uv ───────────────────────────────────────────────────────────────────────
# Check common non-PATH install locations before trying to install.
for _uv_dir in "$HOME/.local/bin" "$HOME/.cargo/bin"; do
  if [[ -x "$_uv_dir/uv" ]] && ! command -v uv &>/dev/null; then
    export PATH="$_uv_dir:$PATH"
  fi
done

if ! command -v uv &>/dev/null; then
  info "uv not found — installing..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Source the env file the installer may have written
  for _uv_env in "$HOME/.local/bin/env" "$HOME/.cargo/env"; do
    # shellcheck disable=SC1090
    [[ -f "$_uv_env" ]] && source "$_uv_env" 2>/dev/null || true
  done
  for _uv_dir in "$HOME/.local/bin" "$HOME/.cargo/bin"; do
    [[ -x "$_uv_dir/uv" ]] && export PATH="$_uv_dir:$PATH" && break
  done
  if command -v uv &>/dev/null; then
    ok "uv installed: $(uv --version 2>&1)"
  else
    err "uv was installed but is not in PATH."
    info "Add \$HOME/.local/bin to your PATH and re-run:"
    info "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    exit 1
  fi
else
  ok "uv $(uv --version 2>&1)"
fi

# ── Python 3.11+ ─────────────────────────────────────────────────────────────
_py_ok=0
if command -v python3 &>/dev/null; then
  _py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
  _py_major="${_py_ver%%.*}"
  _py_minor="${_py_ver#*.}"
  if [[ "$_py_major" -ge 3 && "$_py_minor" -ge 11 ]]; then
    ok "Python ${_py_ver}"
    _py_ok=1
  else
    warn "Python ${_py_ver} is too old — 3.11 or newer is required."
  fi
fi

if [[ "$_py_ok" -eq 0 ]]; then
  if [[ "$_HAS_APT" -eq 1 ]]; then
    info "Installing Python 3.11 via apt..."
    sudo apt-get install -y python3.11 python3.11-venv python3.11-dev
    # Make python3 resolve to 3.11 if it doesn't already
    if python3 -c "import sys; exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
      ok "Python 3.11 installed."
      _py_ok=1
    elif command -v python3.11 &>/dev/null; then
      ok "Python 3.11 installed (invoked as python3.11)."
      _py_ok=1
    else
      err "Python 3.11 installation failed."
      _missing=1
    fi
  else
    err "Python 3.11+ not found."
    info "Install from https://www.python.org/ or via your package manager."
    _missing=1
  fi
fi

# ── Build tools (needed for C-extension wheels: psycopg2, uvicorn, etc.) ─────
if [[ "$_HAS_APT" -eq 1 ]]; then
  _need_build=0
  for _pkg in gcc make libpq-dev libssl-dev; do
    dpkg -s "$_pkg" &>/dev/null 2>&1 || { _need_build=1; break; }
  done
  if [[ "$_need_build" -eq 1 ]]; then
    info "Installing build tools (needed for Python C-extension packages)..."
    sudo apt-get install -y build-essential python3-dev libpq-dev libssl-dev
    ok "Build tools installed."
  fi
fi

# ── Node.js 18+ ───────────────────────────────────────────────────────────────
_MIN_NODE=18
_node_ok=0
if command -v node &>/dev/null; then
  _node_raw=$(node --version 2>/dev/null | sed 's/^v//')
  _node_major="${_node_raw%%.*}"
  if [[ "${_node_major:-0}" -ge "$_MIN_NODE" ]]; then
    ok "Node.js v${_node_raw}"
    _node_ok=1
  else
    warn "Node.js v${_node_raw} is too old (>= ${_MIN_NODE} required)."
  fi
fi

if [[ "$_node_ok" -eq 0 ]]; then
  if [[ "$_HAS_APT" -eq 1 ]]; then
    info "Installing Node.js ${_MIN_NODE}.x via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${_MIN_NODE}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
    if command -v node &>/dev/null; then
      ok "Node.js $(node --version) installed."
      _node_ok=1
      # NodeSource nodejs ships with a bundled npm that may be outdated on Debian
      info "Upgrading npm to latest..."
      sudo npm install -g npm@latest
      ok "npm $(npm --version)"
    else
      err "Node.js installation failed."
      _missing=1
    fi
  else
    warn "Node.js >= ${_MIN_NODE} not found."
    info "Install from https://nodejs.org/ or via nvm: https://github.com/nvm-sh/nvm"
    _missing=1
  fi
fi

# ── npm ───────────────────────────────────────────────────────────────────────
# On Debian/Ubuntu, npm is a separate package from nodejs.
if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  if [[ "$_HAS_APT" -eq 1 ]]; then
    info "npm not found — installing..."
    sudo apt-get install -y npm
    ok "npm $(npm --version)"
  else
    warn "npm not found."
    info "Install npm:  https://www.npmjs.com/get-npm"
    _missing=1
  fi
fi

if [[ "$_missing" -eq 1 ]]; then
  echo
  warn "Fix the missing prerequisites above, then re-run ./install.sh"
  exit 1
fi
echo

# ── Choose PostgreSQL mode ────────────────────────────────────────────────────
step "PostgreSQL mode"

PG_MODE="$PG_FLAG"

if [[ -z "$PG_MODE" ]]; then
  # Try to auto-detect a sensible default
  _sys_ready=0
  _docker_ready=0
  if command -v pg_isready &>/dev/null && pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    _sys_ready=1
  fi
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    _docker_ready=1
  fi

  if [[ -t 0 ]]; then
    # Interactive terminal — present a menu
    echo -e "  Choose a PostgreSQL backend:\n"
    echo -e "    ${CYAN}1${RESET}  System PostgreSQL  ${GRAY}(use the PostgreSQL installed on this machine)${RESET}"
    echo -e "    ${CYAN}2${RESET}  Docker Compose     ${GRAY}(start a containerised PostgreSQL via docker compose)${RESET}"
    echo
    if [[ "$_sys_ready" -eq 1 ]]; then
      info "System PostgreSQL detected on port 5432."
    fi
    if [[ "$_docker_ready" -eq 1 ]]; then
      info "Docker is available."
    fi
    echo
    while true; do
      read -rp "  Enter choice [1/2]: " _choice
      case "$_choice" in
        1) PG_MODE="system"; break ;;
        2) PG_MODE="docker"; break ;;
        *) echo -e "  ${YELLOW}Please enter 1 or 2.${RESET}" ;;
      esac
    done
  else
    # Non-interactive: auto-select based on what's available
    if [[ "$_sys_ready" -eq 1 ]]; then
      PG_MODE="system"
      info "Auto-selected system PostgreSQL (port 5432)."
    elif [[ "$_docker_ready" -eq 1 ]]; then
      PG_MODE="docker"
      info "Auto-selected Docker PostgreSQL."
    else
      err "No PostgreSQL or Docker found."
      info "Install PostgreSQL or Docker, then re-run: ./install.sh --pg=system  or  ./install.sh --pg=docker"
      exit 1
    fi
  fi
fi

echo

# ── Mode-specific setup ───────────────────────────────────────────────────────
case "$PG_MODE" in

  # ── System PostgreSQL ───────────────────────────────────────────────────────
  system)
    PG_PORT="${PG_PORT:-5432}"
    step "System PostgreSQL  (${PG_HOST}:${PG_PORT})"

    if ! command -v psql &>/dev/null; then
      warn "psql not found — PostgreSQL does not appear to be installed."
      echo
      info "Install PostgreSQL for your system, for example:"
      info "  Ubuntu/Debian:  sudo apt install postgresql"
      info "  Fedora/RHEL:    sudo dnf install postgresql-server postgresql"
      info "  Arch:           sudo pacman -S postgresql"
      info "  macOS (brew):   brew install postgresql@16"
      echo
      if [[ -t 0 ]]; then
        read -rp "  PostgreSQL is not installed. Continue anyway? [y/N]: " _cont
        [[ "$_cont" =~ ^[Yy]$ ]] || exit 0
      else
        warn "Continuing without psql — you will need to create the database manually."
      fi
    else
      ok "psql found: $(psql --version 2>&1 | head -1)"
    fi

    # Check if PG is accepting connections
    if command -v pg_isready &>/dev/null && pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
      ok "PostgreSQL is running on ${PG_HOST}:${PG_PORT}"

      # Check / create the foliantica user and database
      echo
      info "Checking for '${PG_USER}' user and '${PG_DB}' database..."

      _user_exists=$(psql -h "$PG_HOST" -p "$PG_PORT" -U postgres \
        -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null || echo "")
      _db_exists=$(psql -h "$PG_HOST" -p "$PG_PORT" -U postgres \
        -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null || echo "")

      if [[ "$_user_exists" != "1" ]]; then
        echo
        info "Creating PostgreSQL user '${PG_USER}'..."
        if sudo -u postgres psql -c \
            "CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}';" 2>/dev/null; then
          ok "User '${PG_USER}' created."
        else
          warn "Could not create user automatically."
          info "Run manually:"
          info "  sudo -u postgres psql -c \"CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}';\""
        fi
      else
        ok "User '${PG_USER}' already exists."
      fi

      if [[ "$_db_exists" != "1" ]]; then
        echo
        info "Creating database '${PG_DB}'..."
        if sudo -u postgres psql -c \
            "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" 2>/dev/null; then
          ok "Database '${PG_DB}' created."
        else
          warn "Could not create database automatically."
          info "Run manually:"
          info "  sudo -u postgres psql -c \"CREATE DATABASE ${PG_DB} OWNER ${PG_USER};\""
        fi
      else
        ok "Database '${PG_DB}' already exists."
      fi
    else
      warn "PostgreSQL is not running or not reachable on ${PG_HOST}:${PG_PORT}."
      echo
      info "Start PostgreSQL, then create the user and database:"
      info "  sudo systemctl start postgresql"
      info "  sudo -u postgres psql -c \"CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}';\""
      info "  sudo -u postgres psql -c \"CREATE DATABASE ${PG_DB} OWNER ${PG_USER};\""
      echo
      info "LaunchFoliantica.sh will retry for 60 s when you start the app."
    fi
    ;;

  # ── Docker Compose PostgreSQL ───────────────────────────────────────────────
  docker)
    # Same port/container as the installed app's Docker PG by default, so a
    # source-run instance shares the real database rather than a separate copy.
    PG_PORT="${PG_PORT:-15434}"
    step "Docker Compose PostgreSQL  (port ${PG_PORT})"

    if ! command -v docker &>/dev/null; then
      err "Docker not found."
      info "Install Docker Engine:   https://docs.docker.com/engine/install/"
      info "Or Docker Desktop:       https://www.docker.com/products/docker-desktop/"
      exit 1
    fi
    ok "Docker found: $(docker --version)"

    if ! docker info &>/dev/null 2>&1; then
      warn "Docker daemon is not running. Start it, then re-run:"
      info "  sudo systemctl start docker"
      info "  ./install.sh --pg=docker"
    else
      ok "Docker daemon is running."
      echo
      info "Pulling PostgreSQL image (this may take a moment on first run)..."
      if docker compose --profile postgres pull 2>/dev/null; then
        ok "PostgreSQL image ready."
      else
        warn "Could not pull image now. It will be downloaded on first launch."
      fi
    fi
    ;;

  *)
    err "Unknown --pg value: '${PG_MODE}'  (valid: system, docker)"
    exit 1
    ;;
esac

echo

# ── Save preference to ~/.foliantica/config.json ──────────────────────────────
step "Saving configuration"

mkdir -p "$FOLIANTICA_DIR"

# Build the pg JSON block
case "$PG_MODE" in
  system)
    _pg_json="{\"useSystem\": true, \"host\": \"${PG_HOST}\", \"port\": ${PG_PORT}, \"user\": \"${PG_USER}\", \"pass\": \"${PG_PASS}\", \"db\": \"${PG_DB}\"}"
    ;;
  docker)
    _pg_json="{\"useDocker\": true, \"host\": \"${PG_HOST}\", \"port\": ${PG_PORT}, \"user\": \"${PG_USER}\", \"pass\": \"${PG_PASS}\", \"db\": \"${PG_DB}\"}"
    ;;
esac

# Merge into existing config (preserves dataDir and other keys)
python3 - <<PYEOF
import json, os

cfg_path = "$CONFIG_FILE"
cfg = {}
try:
    with open(cfg_path) as f:
        cfg = json.load(f)
except Exception:
    pass

cfg["pg"] = json.loads('$_pg_json')

with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2)

print(f"  Config written to {cfg_path}")
PYEOF

ok "PostgreSQL mode '${PG_MODE}' saved to ${CONFIG_FILE}"
echo

# ── Python venv ───────────────────────────────────────────────────────────────
step "Python environment"

if [[ ! -d "$ROOT/api/.venv" ]]; then
  info "Creating virtual environment..."
  uv venv "$ROOT/api/.venv"
fi

info "Installing/updating Python dependencies..."
uv pip install --quiet --python "$ROOT/api/.venv/bin/python" -e "$ROOT/api"

# Verify uvicorn is reachable — if the binary wheel was unavailable uv may
# have skipped it silently (e.g. missing libpq-dev on some Debian builds).
if ! "$ROOT/api/.venv/bin/python" -c "import uvicorn" 2>/dev/null; then
  warn "uvicorn not importable after install — retrying explicitly..."
  uv pip install --python "$ROOT/api/.venv/bin/python" "uvicorn[standard]"
  if ! "$ROOT/api/.venv/bin/python" -c "import uvicorn" 2>/dev/null; then
    err "uvicorn could not be installed."
    if [[ "$_HAS_APT" -eq 1 ]]; then
      info "You may need build tools:  sudo apt-get install -y build-essential python3-dev"
    fi
    exit 1
  fi
fi
_uv_ver=$("$ROOT/api/.venv/bin/python" -c 'import uvicorn; print(uvicorn.__version__)' 2>/dev/null || echo "unknown")
ok "Python dependencies installed (uvicorn ${_uv_ver})."
echo

# ── npm packages ──────────────────────────────────────────────────────────────
step "Frontend packages"

info "Installing npm packages..."
(cd "$ROOT/web" && npm install --legacy-peer-deps)
if [[ ! -f "$ROOT/web/node_modules/.bin/next" ]]; then
  err "npm install finished but 'next' was not found in node_modules."
  info "Run manually:  cd web && npm install --legacy-peer-deps"
  exit 1
fi
ok "npm packages installed."
echo

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "  ${GRAY}----------------------------------------------${RESET}"
echo -e "  ${BOLD}${GREEN}Setup complete!${RESET}"
echo
echo -e "  Start the app:"
echo -e "    ${CYAN}./LaunchFoliantica.sh${RESET}"
echo
if [[ "$PG_MODE" == "system" ]]; then
  echo -e "  ${GRAY}Make sure PostgreSQL is running before launching.${RESET}"
  echo -e "  ${GRAY}  sudo systemctl start postgresql${RESET}"
  echo
elif [[ "$PG_MODE" == "docker" ]]; then
  echo -e "  ${GRAY}Docker PostgreSQL will start automatically on launch.${RESET}"
  echo
fi
