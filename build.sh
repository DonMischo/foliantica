#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Foliantica — single build script  (macOS / Linux)
# Run from the project root:  ./build.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✔ $1${NC}"; }
die()  { echo -e "${RED}✖ $1${NC}" >&2; exit 1; }

# ── Prerequisite checks ───────────────────────────────────────────────────────
step "Checking prerequisites"
command -v node  >/dev/null 2>&1 || die "node not found — install Node.js 20+"
command -v npm   >/dev/null 2>&1 || die "npm not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found — install Python 3.11+"

ok "Prerequisites OK"

# ── Step 1 — Electron dependencies ───────────────────────────────────────────
step "Installing Electron dependencies"
rm -rf node_modules   # ensure clean state
npm install
ok "Electron deps installed"

# ── Step 2 — Next.js standalone build ────────────────────────────────────────
step "Building Next.js (standalone)"
cd "$ROOT/web"
rm -rf node_modules
npm install --legacy-peer-deps
npm run build

# Copy static assets into standalone (Next.js doesn't do this automatically).
# When a parent node_modules exists the standalone nests output under "web/";
# detect which layout was produced and copy to the right place.
if [ -d ".next/standalone/web" ]; then
  cp -r .next/static   .next/standalone/web/.next/static
  cp -r public         .next/standalone/web/public 2>/dev/null || true
else
  cp -r .next/static   .next/standalone/.next/static
  cp -r public         .next/standalone/public 2>/dev/null || true
fi
ok "Next.js built"

# Stage the standalone for electron-builder
cd "$ROOT"
rm -rf .next-standalone
if [ -d "web/.next/standalone/web" ]; then
  cp -r web/.next/standalone/web .next-standalone
else
  cp -r web/.next/standalone .next-standalone
fi
cp web/server-wrapper.js .next-standalone/server-wrapper.js
ok "Next.js standalone staged → .next-standalone/"

# ── Step 3 — FastAPI / PyInstaller ───────────────────────────────────────────
step "Building FastAPI backend with PyInstaller"
cd "$ROOT/api"

# Install dependencies and pyinstaller into the project venv (uv preferred, pip fallback)
if command -v uv >/dev/null 2>&1; then
  uv sync
  uv pip install pyinstaller
  uv run pyinstaller foliantica.spec \
    --distpath "$ROOT/api-dist-tmp" \
    --workpath "$ROOT/.pyinstaller-work" \
    --clean --noconfirm
else
  pip install .
  pip install pyinstaller
  python -m PyInstaller foliantica.spec \
    --distpath "$ROOT/api-dist-tmp" \
    --workpath "$ROOT/.pyinstaller-work" \
    --clean --noconfirm
fi

ok "PyInstaller build done"

# Stage the onedir output flat into api-dist/
cd "$ROOT"
rm -rf api-dist
mv api-dist-tmp/foliantica-api api-dist
rm -rf api-dist-tmp
ok "API binary staged → api-dist/"

# ── Step 4 — Electron build ───────────────────────────────────────────────────
step "Packaging with electron-builder"
npm run dist -- --publish never
ok "Done!  Installers are in dist/"
echo ""
echo "  macOS:  dist/*.dmg"
echo "  Linux:  dist/*.AppImage"
