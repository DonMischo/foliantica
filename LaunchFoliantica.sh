#!/usr/bin/env bash
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RESET="\033[0m"; BOLD="\033[1m"; CYAN="\033[96m"
  GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"
  GRAY="\033[90m"; WHITE="\033[97m"
else
  RESET="" BOLD="" CYAN="" GREEN="" YELLOW="" RED="" GRAY="" WHITE=""
fi

err()  { echo -e "  ${RED}[ERROR]${RESET} $*" >&2; }
warn() { echo -e "  ${YELLOW}[WARN]${RESET}  $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
PG_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --pg=*) PG_FLAG="${arg#--pg=}" ;;
    --help|-h)
      echo
      echo -e "  ${BOLD}${CYAN}Foliantica${RESET}  —  Dev launcher"
      echo
      echo -e "  ${WHITE}Usage:${RESET}  ${YELLOW}./LaunchFoliantica.sh${RESET} ${GRAY}[--pg=system|docker] [--help]${RESET}"
      echo
      echo -e "  ${WHITE}PostgreSQL modes:${RESET}"
      echo -e "    ${YELLOW}--pg=system${RESET}   Use installed system PostgreSQL  (default port 5432)"
      echo -e "    ${YELLOW}--pg=docker${RESET}   Start PostgreSQL via Docker Compose  (port 5434)"
      echo
      echo -e "  ${WHITE}Persist a preference:${RESET}  ${GRAY}~/.foliantica/config.json${RESET}"
      echo -e "    ${GRAY}{\"pg\":{\"useSystem\":true}}   — always use system PG${RESET}"
      echo -e "    ${GRAY}{\"pg\":{\"useDocker\":true}}   — always use Docker PG${RESET}"
      echo
      echo -e "  ${WHITE}Prerequisites:${RESET}  uv  ${CYAN}https://docs.astral.sh/uv/${RESET}   |   Node  ${CYAN}https://nodejs.org/${RESET}"
      echo
      echo -e "  ${WHITE}System PG first-time setup:${RESET}"
      echo -e "    ${GRAY}sudo -u postgres psql -c \"CREATE USER foliantica WITH PASSWORD 'foliantica';\"${RESET}"
      echo -e "    ${GRAY}sudo -u postgres psql -c \"CREATE DATABASE foliantica OWNER foliantica;\"${RESET}"
      echo
      exit 0
      ;;
  esac
done

echo
echo -e "  ${BOLD}${CYAN}Foliantica${RESET}  —  Starting..."
echo -e "  ${GRAY}-------------------------------------${RESET}"
echo

# ── Prerequisites ─────────────────────────────────────────────────────────────
if ! command -v uv &>/dev/null; then
  err "uv not found."
  echo -e "         Install: ${CYAN}curl -LsSf https://astral.sh/uv/install.sh | sh${RESET}" >&2
  exit 1
fi
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from ${CYAN}https://nodejs.org/${RESET}" >&2
  exit 1
fi

# ── Python environment ────────────────────────────────────────────────────────
if [[ ! -d "$ROOT/api/.venv" ]]; then
  echo -e "  ${WHITE}Creating Python environment...${RESET}"
  uv venv "$ROOT/api/.venv"
  echo
fi

echo -e "  ${WHITE}Checking Python dependencies...${RESET}"
uv pip install --quiet --python "$ROOT/api/.venv/bin/python" -e "$ROOT/api"
echo

# ── npm packages ──────────────────────────────────────────────────────────────
if [[ ! -f "$ROOT/web/node_modules/.bin/next" ]]; then
  echo -e "  ${WHITE}Installing npm packages (first run — takes a minute)...${RESET}"
  (cd "$ROOT/web" && npm install)
  if [[ ! -f "$ROOT/web/node_modules/.bin/next" ]]; then
    err "npm install finished but 'next' was not installed."
    echo -e "         Run manually:  ${GRAY}cd web && npm install${RESET}" >&2
    exit 1
  fi
  echo
fi

# ── Read pg config from ~/.foliantica/config.json ─────────────────────────────
PG_MODE=""
PG_HOST="127.0.0.1"
PG_PORT=""
PG_USER="foliantica"
PG_PASS="foliantica"
PG_DB="foliantica"

_cfg="$HOME/.foliantica/config.json"
if [[ -z "$PG_FLAG" && -f "$_cfg" ]]; then
  _py="$ROOT/api/.venv/bin/python"
  _jq() { "$_py" -c "import json; d=json.load(open('$_cfg')); print(d.get('pg',{}).get('$1',''))" 2>/dev/null || true; }
  _use_docker=$(_jq useDocker)
  _use_system=$(_jq useSystem)
  _pg_port=$(_jq port)
  _pg_user=$(_jq user)
  _pg_pass=$(_jq pass)
  _pg_db=$(_jq db)
  [[ "$_use_docker" == "True" ]]                 && PG_MODE="docker"
  [[ "$_use_system" == "True" ]]                 && PG_MODE="system"
  [[ -n "$_pg_port" && "$_pg_port" != "None" ]] && PG_PORT="$_pg_port"
  [[ -n "$_pg_user" && "$_pg_user" != "None" ]] && PG_USER="$_pg_user"
  [[ -n "$_pg_pass" && "$_pg_pass" != "None" ]] && PG_PASS="$_pg_pass"
  [[ -n "$_pg_db"   && "$_pg_db"   != "None" ]] && PG_DB="$_pg_db"
fi

# Command-line flag overrides config
[[ -n "$PG_FLAG" ]] && PG_MODE="$PG_FLAG"

# ── Auto-detect PG mode if still unset ────────────────────────────────────────
if [[ -z "$PG_MODE" ]]; then
  if command -v pg_isready &>/dev/null && pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    PG_MODE="system"
    echo -e "  ${GRAY}Auto-detected system PostgreSQL on port 5432.${RESET}"
    echo -e "  ${GRAY}Override with --pg=docker.${RESET}"
    echo
  elif command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    PG_MODE="docker"
    echo -e "  ${GRAY}No system PostgreSQL found — using Docker.${RESET}"
    echo -e "  ${GRAY}Override with --pg=system.${RESET}"
    echo
  else
    err "No PostgreSQL found. Install PostgreSQL or Docker, then rerun:"
    echo -e "         ${GRAY}./install.sh --pg=system${RESET}  or  ${GRAY}./install.sh --pg=docker${RESET}" >&2
    exit 1
  fi
fi

# ── PostgreSQL setup ──────────────────────────────────────────────────────────
PG_PID=""

case "$PG_MODE" in

  system)
    PG_PORT="${PG_PORT:-5432}"
    echo -e "  ${WHITE}PostgreSQL${RESET}  ${GRAY}system — ${PG_HOST}:${PG_PORT}${RESET}"
    if command -v pg_isready &>/dev/null; then
      if pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
        echo -e "  ${WHITE}PostgreSQL${RESET}  ${GREEN}ready${RESET}"
      else
        warn "PostgreSQL not ready on ${PG_HOST}:${PG_PORT}. The API will retry for up to 60 s."
        echo -e "         First-time setup:"
        echo -e "           ${GRAY}sudo -u postgres psql -c \"CREATE USER foliantica WITH PASSWORD 'foliantica';\"${RESET}"
        echo -e "           ${GRAY}sudo -u postgres psql -c \"CREATE DATABASE foliantica OWNER foliantica;\"${RESET}"
      fi
    fi
    export LW_PG_HOST="$PG_HOST"
    export LW_PG_PORT="$PG_PORT"
    export LW_PG_USER="$PG_USER"
    export LW_PG_PASS="$PG_PASS"
    export LW_PG_DB="$PG_DB"
    ;;

  docker)
    PG_PORT="${PG_PORT:-5434}"
    echo -e "  ${WHITE}PostgreSQL${RESET}  ${GRAY}Docker — port ${PG_PORT}${RESET}"
    if ! command -v docker &>/dev/null; then
      err "Docker not found. Install from ${CYAN}https://docs.docker.com/engine/install/${RESET}"
      exit 1
    fi
    if ! docker info &>/dev/null 2>&1; then
      err "Docker daemon is not running. Start it with:"
      echo -e "         ${GRAY}sudo systemctl start docker${RESET}" >&2
      exit 1
    fi
    echo -e "  ${GRAY}Starting foliantica-postgres container...${RESET}"
    docker compose --profile postgres up -d
    # Wait up to 30 s for PG to accept connections
    _ready=0
    for _i in $(seq 1 30); do
      if docker exec foliantica-postgres pg_isready -U "$PG_USER" &>/dev/null 2>&1; then
        _ready=1; break
      fi
      sleep 1
    done
    if [[ "$_ready" -eq 1 ]]; then
      echo -e "  ${WHITE}PostgreSQL${RESET}  ${GREEN}ready on port ${PG_PORT}${RESET}"
    else
      warn "PostgreSQL container not ready after 30 s. The API will keep retrying."
    fi
    export LW_PG_HOST="$PG_HOST"
    export LW_PG_PORT="$PG_PORT"
    export LW_PG_USER="$PG_USER"
    export LW_PG_PASS="$PG_PASS"
    export LW_PG_DB="$PG_DB"
    ;;

  *)
    err "Unknown --pg value: '${PG_MODE}'  (valid: system, docker)"
    exit 1
    ;;
esac

echo

# ── Cleanup on Ctrl+C ─────────────────────────────────────────────────────────
API_PID="" WEB_PID=""
cleanup() {
  echo
  echo -e "  ${GRAY}Stopping...${RESET}"
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "$PG_PID"  ]] && kill "$PG_PID"  2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Launch ────────────────────────────────────────────────────────────────────
echo -e "  ${BOLD}${CYAN}Foliantica${RESET}"
echo -e "  ${GRAY}-------------------------------------${RESET}"
echo -e "  ${WHITE}App   ${RESET}${CYAN}http://localhost:3000${RESET}"
echo -e "  ${WHITE}API   ${RESET}${CYAN}http://localhost:8765${RESET}  ${GRAY}(Swagger: /docs)${RESET}"
echo -e "  ${GRAY}-------------------------------------${RESET}"
echo -e "  ${GRAY}Data folder: Settings page (stored in ~/.foliantica/config.json)${RESET}"
echo -e "  ${GRAY}Press Ctrl+C to stop.${RESET}"
echo

(cd "$ROOT/api" && .venv/bin/python run.py --dev 2>&1 \
  | while IFS= read -r line; do echo -e "  ${GRAY}[backend] ${RESET} $line"; done) &
API_PID=$!

sleep 1

(cd "$ROOT/web" && LW_API_PORT=8765 npm run dev 2>&1 \
  | while IFS= read -r line; do echo -e "  ${CYAN}[frontend]${RESET} $line"; done) &
WEB_PID=$!

wait
