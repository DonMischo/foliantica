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
#   ./install.sh --pg=docker       — Docker Compose PostgreSQL (port 5434)
#   ./install.sh --pg=sqlite       — SQLite (dev-only, no PG needed)
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
      echo -e "  ${WHITE}Usage:${RESET}  ${YELLOW}./install.sh${RESET} ${GRAY}[--pg=system|docker|sqlite] [options]${RESET}"
      echo
      echo -e "  ${WHITE}PostgreSQL options:${RESET}"
      echo -e "    ${YELLOW}--pg=system${RESET}      Use installed system PostgreSQL  (default port 5432)"
      echo -e "    ${YELLOW}--pg=docker${RESET}      Use Docker Compose PostgreSQL    (port 5434)"
      echo -e "    ${YELLOW}--pg=sqlite${RESET}      Use SQLite instead               (dev only)"
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

if command -v uv &>/dev/null; then
  ok "uv $(uv --version 2>&1 | head -1)"
else
  warn "uv not found."
  info "Install:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  info "Then add  \$HOME/.cargo/bin  (or  \$HOME/.local/bin)  to your PATH and re-run."
  _missing=1
fi

if command -v node &>/dev/null; then
  ok "Node.js $(node --version)"
else
  warn "Node.js not found."
  info "Install from  https://nodejs.org/  or via your package manager."
  _missing=1
fi

if command -v python3 &>/dev/null; then
  ok "Python $(python3 --version 2>&1)"
else
  warn "python3 not found — needed by the backend."
  _missing=1
fi

if [[ "$_missing" -eq 1 ]]; then
  echo
  warn "Install the missing prerequisites above, then re-run ./install.sh"
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
    echo -e "    ${CYAN}3${RESET}  SQLite             ${GRAY}(no PostgreSQL — dev / testing only)${RESET}"
    echo
    if [[ "$_sys_ready" -eq 1 ]]; then
      info "System PostgreSQL detected on port 5432."
    fi
    if [[ "$_docker_ready" -eq 1 ]]; then
      info "Docker is available."
    fi
    echo
    while true; do
      read -rp "  Enter choice [1/2/3]: " _choice
      case "$_choice" in
        1) PG_MODE="system"; break ;;
        2) PG_MODE="docker"; break ;;
        3) PG_MODE="sqlite"; break ;;
        *) echo -e "  ${YELLOW}Please enter 1, 2, or 3.${RESET}" ;;
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
      PG_MODE="sqlite"
      warn "No PostgreSQL or Docker found — falling back to SQLite."
      info "Re-run with --pg=system or --pg=docker once PostgreSQL is available."
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
    PG_PORT="${PG_PORT:-5434}"
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

  # ── SQLite ──────────────────────────────────────────────────────────────────
  sqlite)
    step "SQLite mode  (development only)"
    warn "SQLite is not recommended for production use."
    info "Switch to PostgreSQL later by re-running:  ./install.sh --pg=system"
    ;;

  *)
    err "Unknown --pg value: '${PG_MODE}'  (valid: system, docker, sqlite)"
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
  sqlite)
    _pg_json="{\"useSQLite\": true}"
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
ok "Python dependencies installed."
echo

# ── npm packages ──────────────────────────────────────────────────────────────
step "Frontend packages"

if [[ ! -d "$ROOT/web/node_modules" ]]; then
  info "Installing npm packages (first run — takes a moment)..."
  (cd "$ROOT/web" && npm install --silent)
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
