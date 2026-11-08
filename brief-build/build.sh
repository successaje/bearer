#!/bin/zsh
# Usage: build.sh <brief.md> <out.pdf> [cover.html] [title]
# Renders a brief to PDF in the house style (pandoc → HTML → headless Chrome).
set -euo pipefail
here="${0:A:h}"
src="$1"; out="$2"
cover="${3:-$here/cover.html}"
title="${4:-Bearer: Build Prompt}"

# The cover replaces the Markdown title block, so start the PDF body at "## Contents".
awk 'found || /^## Contents$/ { found = 1; print }' "$src" > "$here/body.md"

pandoc "$here/body.md" -f gfm -t html5 -s \
  --metadata pagetitle="$title" \
  --highlight-style=breezedark \
  -H "$here/head.html" -B "$cover" \
  -o "$here/brief.html"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$here/brief.pdf" "file://$here/brief.html" 2>/dev/null

cp "$here/brief.pdf" "$out"
pdfinfo "$out" | grep -E "^(Pages|Title)"
