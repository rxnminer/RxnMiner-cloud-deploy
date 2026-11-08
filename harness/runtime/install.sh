#!/usr/bin/env bash
# Host-mode install for RxnMiner: pinned Node + Pi under ./node_modules, pinned Python deps.
# Docker is the reference environment (docker/Dockerfile); use this when you would rather run
# on the host. Requires: npm (any recent Node to bootstrap), python3 >= 3.10 with pip.
#
#   bash runtime/install.sh                 # install into the checkout
#   NPM_REGISTRY=https://... PIP_INDEX_URL=https://... bash runtime/install.sh   # mirrors
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/runtime/pi.version"

command -v npm >/dev/null || { echo "npm is required to bootstrap the pinned Node runtime" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }

if [[ -n "${NPM_REGISTRY:-}" ]]; then
  npm config set registry "$NPM_REGISTRY"
fi
npm install --no-audit --no-fund --omit=dev "$NODE_PACKAGE" "$PI_PACKAGE" "$TYPEBOX_PACKAGE"
export PATH="$ROOT/node_modules/node/bin:$PATH"
"$ROOT/node_modules/.bin/pi" --version

pip_args=(--no-cache-dir)
if [[ -n "${PIP_INDEX_URL:-}" ]]; then
  pip_args+=(-i "$PIP_INDEX_URL")
fi
if python3 -m pip install --help 2>/dev/null | grep -q -- --break-system-packages; then
  pip_args+=(--break-system-packages)
fi
python3 -m pip install "${pip_args[@]}" -r "$ROOT/requirements.txt"
python3 -c "from rdkit import Chem; from rdkit.Chem import Draw; from PIL import Image; m=Chem.MolFromSmiles('Brc1ccccc1'); assert m is not None; assert isinstance(Draw.MolToImage(m,size=(160,120)), Image.Image)"

[[ -d "$ROOT/third_party/molecular_assembly" ]] || { echo "third_party/ is missing or incomplete; this checkout is damaged (see THIRD_PARTY.md)" >&2; exit 2; }
python3 "$ROOT/tools/verify_third_party.py"
( cd "$ROOT" && find . -type f ! -name MANIFEST.sha256 ! -path './.git/*' ! -path './node_modules/*' ! -name '*.pyc' -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256 )
echo "RxnMiner host install complete: $(node --version) / pi $("$ROOT/node_modules/.bin/pi" --version 2>/dev/null | head -1)"
echo "next: python3 bin/rxnminer check"
