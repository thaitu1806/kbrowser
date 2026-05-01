#!/bin/bash
set -e

echo ""
echo "============================================"
echo "  Ken's Browser IM - Build Portable"
echo "============================================"
echo ""

# Lay thu muc chua file build.sh (goc project)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
echo "Thu muc project: $SCRIPT_DIR"
echo ""

# Kiem tra Node.js
echo "[1/4] Kiem tra Node.js..."
if ! command -v node &> /dev/null; then
    echo ""
    echo "[LOI] Khong tim thay Node.js!"
    echo "  Cai tai: https://nodejs.org"
    exit 1
fi
echo "  OK - Node.js $(node -v)"

# Kiem tra npm
echo "[2/4] Kiem tra npm..."
if ! command -v npm &> /dev/null; then
    echo "[LOI] Khong tim thay npm!"
    exit 1
fi
echo "  OK - npm $(npm -v)"

# Cai dependencies
echo ""
echo "[3/4] Cai dat dependencies..."
npm install
echo "  OK - Dependencies da cai xong"

# Build portable
echo ""
echo "[4/4] Build portable exe..."
npm run dist

echo ""
echo "============================================"
echo "  BUILD HOAN TAT!"
echo "============================================"
echo ""
echo "File portable: release/KensBrowserIM-0.1.0-portable.exe"
echo ""
