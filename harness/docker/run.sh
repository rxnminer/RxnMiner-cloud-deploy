#!/usr/bin/env bash
# Run RxnMiner on one figure inside the reference image.
#   bash docker/run.sh FIGURE.png OUT_DIR [extra rxnminer extract args...]
# Reads ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY (or OPENAI_*) and MOLPARSER_URL from the caller's
# environment and passes them into the container; nothing is written into the image.
set -euo pipefail
FIGURE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
shift 2
# On daemons with user-namespace remapping, root inside the container is an unprivileged host
# uid and cannot write into a host directory owned by the caller. Open the output directory
# so the run can always write its artifacts there.
chmod 777 "$OUT"
TAG="${RXNMINER_TAG:-rxnminer:local}"
NAME="rxnminer-$(date -u +%Y%m%dT%H%M%S)-$$"
env_args=()
for v in ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_BASE_URL OPENAI_API_KEY \
         RXNMINER_BASE_URL RXNMINER_API_KEY MOLPARSER_URL OCSR_CACHE OCSR_OFFLINE \
         PI_HTTP_IDLE_TIMEOUT_MS PI_RETRY_MAX_RETRIES PI_RETRY_BASE_DELAY_MS PI_RETRY_MAX_RETRY_DELAY_MS; do
  [[ -z "${!v:-}" ]] || env_args+=(-e "$v")
done
# Some daemons drop docker run's stdout; the runner writes everything under OUT anyway.
docker run --name "$NAME" --rm "${env_args[@]}" \
  --mount "type=bind,src=$FIGURE,dst=/app/figure.png,readonly" \
  --mount "type=bind,src=$OUT,dst=/out" \
  "$TAG" extract /app/figure.png --out /out --workdir /app "$@"
echo "artifacts in $OUT (answer.json, plan.json, review.html, run.json, pi.log, pi-agent-dir/sessions)"
