#!/usr/bin/env bash
#
# Build _zips/installzip.zip — the package the zip installer downloads.
# Run from the repo root, then commit the updated zip.
#
#   bash scripts/build-installzip.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="_zips/installzip.zip"
mkdir -p _zips
rm -f "$OUT"

# Package everything needed to run, excluding secrets, vendored deps, git, and
# the zip dir itself. Composer deps are restored at build time inside Docker.
zip -rq "$OUT" . \
  -x '.git/*' \
  -x 'vendor/*' \
  -x '_zips/*' \
  -x 'scripts/installzip.zip' \
  -x '.env' \
  -x '.DS_Store' \
  -x '*/.DS_Store' \
  -x 'INITIAL_GOD_PASSWORD.txt' \
  -x '*.log'

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "Now: git add $OUT && git commit -m 'Update install package' && git push"
