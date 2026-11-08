#!/usr/bin/env bash
# Build the RxnMiner reference image from this checkout.
#   bash docker/build.sh                       # -> rxnminer:local
#   RXNMINER_TAG=rxnminer:0.1 bash docker/build.sh
# Proxy / mirror knobs (all optional): HTTP_PROXY, HTTPS_PROXY, PIP_INDEX_URL, NPM_REGISTRY,
# APT_MIRROR, NODE_IMAGE. Uses --pull=false when the base image is already local.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${RXNMINER_TAG:-rxnminer:local}"
args=(--file "$ROOT/docker/Dockerfile" --tag "$TAG")
[[ -z "${HTTP_PROXY:-${http_proxy:-}}" ]] || args+=(--build-arg "http_proxy=${HTTP_PROXY:-$http_proxy}")
[[ -z "${HTTPS_PROXY:-${https_proxy:-}}" ]] || args+=(--build-arg "https_proxy=${HTTPS_PROXY:-$https_proxy}")
[[ -z "${PIP_INDEX_URL:-}" ]] || args+=(--build-arg "PIP_INDEX_URL=$PIP_INDEX_URL")
[[ -z "${NPM_REGISTRY:-}" ]] || args+=(--build-arg "NPM_REGISTRY=$NPM_REGISTRY")
[[ -z "${APT_MIRROR:-}" ]] || args+=(--build-arg "APT_MIRROR=$APT_MIRROR")
[[ -z "${NODE_IMAGE:-}" ]] || args+=(--build-arg "NODE_IMAGE=$NODE_IMAGE")
if docker buildx version >/dev/null 2>&1; then
  BUILD=(docker buildx build --load)
else
  BUILD=(docker build)
fi
if [[ -n "${NODE_IMAGE:-}" ]] && docker image inspect "$NODE_IMAGE" >/dev/null 2>&1; then
  BUILD+=(--pull=false)
fi
echo "building $TAG from $ROOT"
"${BUILD[@]}" "${args[@]}" "$ROOT"
docker run --rm "$TAG" check || true
echo "built $TAG"
