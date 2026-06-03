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

err() { echo -e "  ${RED}[ERROR]${RESET} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo
  echo -e "  ${BOLD}${CYAN}Foliantica${RESET}  —  Dev launcher"
  echo
  echo -e "  ${WHITE}Usage:${RESET}  ${YELLOW}./LaunchFoliantica.sh${RESET} ${GRAY}[--help]${RESET}"
  echo
  echo -e "  ${WHITE}What it does:${RESET}"
  echo -e "    ${GRAY}- Creates api/.venv on first run${RESET}"
  echo -e "    ${GRAY}- Installs/updates Python deps via uv${RESET}"
  echo -e "    ${GRAY}- Installs npm packages on first run${RESET}"
  echo -e "    ${GRAY}- Runs backend + frontend in this terminal${RESET}"
  echo
  echo -e "  ${WHITE}Prerequisites:${RESET}  uv  ${CYAN}https://docs.astral.sh/uv/${RESET}   |   Node  ${CYAN}https://nodejs.org/${RESET}"
  echo
  echo -e "  ${WHITE}Data folder:${RESET}  ${GRAY}Configure in Settings page, stored in${RESET} ${YELLOW}~/.foliantica/config.json${RESET}"
  echo
  exit 0
fi

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
if [[ ! -d "$ROOT/web/node_modules" ]]; then
  echo -e "  ${WHITE}Installing npm packages (first run — takes a minute)...${RESET}"
  (cd "$ROOT/web" && npm install --silent)
  echo
fi

# ── Cleanup on Ctrl+C ────────────────────────────────────────────────────────
API_PID="" WEB_PID=""
cleanup() {
  echo
  echo -e "  ${GRAY}Stopping...${RESET}"
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
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
