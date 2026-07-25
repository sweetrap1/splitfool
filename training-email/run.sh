#!/usr/bin/env bash
# ============================================================
#  Weekly FMCSA Training Email - Mac/Linux launcher
#  Run:  ./run.sh          (preview only)
#        ./run.sh --send   (email the staff list)
#  Make it executable once with:  chmod +x run.sh
# ============================================================

cd "$(dirname "$0")" || exit 1

python3 main.py "$@"

echo
echo "Done. Your files are in the 'output' folder."
