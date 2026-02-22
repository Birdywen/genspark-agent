#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="/private/tmp/odin_env/bin/python3"
CLI="$SCRIPT_DIR/odin_cli.py"

if [ ! -f "$PYTHON" ]; then
    echo "ERROR: venv not found. Run: python3 -m venv /private/tmp/odin_env && /private/tmp/odin_env/bin/pip install odinai-sdk"
    exit 1
fi

exec "$PYTHON" "$CLI" "$@"