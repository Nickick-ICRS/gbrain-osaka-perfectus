#!/bin/bash
# Run this INSIDE the gbrain dev container to install deps and build the binary.
#
# Usage:
#   First time — install deps and compile the binary:
#     bash install-dependencies.sh
#
#   Skip the compile, just refresh node_modules:
#     bash install-dependencies.sh --skip-build
#
#   Only recompile the binary (deps already installed):
#     bash install-dependencies.sh --skip-install

set -e

WORKSPACE=/app

SKIP_INSTALL=false
SKIP_BUILD=false

for arg in "$@"; do
    case $arg in
        --skip-install) SKIP_INSTALL=true ;;
        --skip-build)   SKIP_BUILD=true ;;
        --help)
            echo "Usage: $0 [--skip-install] [--skip-build]"
            exit 0 ;;
    esac
done

cd "$WORKSPACE"

# === Install dependencies ===
if [ "$SKIP_INSTALL" = false ]; then
    echo "=== bun install ==="
    bun install
else
    echo "=== Skipping bun install ==="
fi

# === Compile the standalone binary into /app/bin/gbrain ===
if [ "$SKIP_BUILD" = false ]; then
    echo "=== Building bin/gbrain ==="
    bun build --compile --outfile bin/gbrain src/cli.ts
else
    echo "=== Skipping build ==="
fi

# === Verification ===
echo "=== Verification ==="
bun --version
if [ -x bin/gbrain ]; then
    echo "gbrain binary: $(bin/gbrain --version)"
else
    echo "gbrain binary not built (dev mode: use 'bun run dev --help')"
fi
echo ""
echo "=== Ready ==="
echo "  gbrain --help                 # compiled binary (on PATH)"
echo "  bun run dev --help            # run from source"
echo "  gbrain init --pglite          # 2-second local brain, no DB"
