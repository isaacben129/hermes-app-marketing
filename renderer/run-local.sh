#!/usr/bin/env sh
set -eu
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE"
python3 -c 'from PIL import Image' >/dev/null 2>&1 || { echo 'Install Pillow: python3 -m pip install -r requirements.txt' >&2; exit 1; }
exec python3 server.py
