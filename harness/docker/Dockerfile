# RxnMiner reference runtime. Reproduces the sidecar image the paper numbers were produced
# with (ChemRxn_Benchmark docker/Dockerfile.base + Dockerfile.pi), minus the benchmark-only
# pieces (verifier, Claude Code, chem_extract harness). Build from the repository root:
#
#   bash docker/build.sh                      # -> rxnminer:local
#   # behind a proxy / with mirrors: HTTP_PROXY, HTTPS_PROXY, PIP_INDEX_URL, NPM_REGISTRY,
#   # APT_MIRROR and NODE_IMAGE are read by docker/build.sh and passed as build args.
#
# Layer order is chosen so that editing the Skill or the tools only re-runs the final COPY:
# system packages, Python packages and the pinned Node/Pi runtime are installed first.
# The payload lives at /opt/rxn-skills inside the image, the same root the paper lane used, so
# every path the tools and the prompt name resolves identically.
ARG NODE_IMAGE=node:20-bookworm-slim
FROM ${NODE_IMAGE}
ARG DEBIAN_FRONTEND=noninteractive
ARG APT_MIRROR=
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG http_proxy=
ARG https_proxy=
ARG no_proxy=localhost,127.0.0.1

RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org/debian|$APT_MIRROR|g; s|http://security.debian.org/debian-security|$APT_MIRROR-security|g" \
        /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       bash ca-certificates git procps python3 python3-pip \
       libfontconfig1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -i "$PIP_INDEX_URL" \
      -r /tmp/requirements.txt \
    && python3 -c "from PIL import Image; from rdkit import Chem; from rdkit.Chem import Draw; m=Chem.MolFromSmiles('Brc1ccccc1'); assert m is not None; im=Draw.MolToImage(m,size=(160,120)); assert isinstance(im,Image.Image) and im.size==(160,120)"

# Pinned Node + Pi under the payload root: one PATH entry, covered by the manifest.
COPY runtime/pi.version /opt/rxn-skills/runtime/pi.version
RUN set -e; . /opt/rxn-skills/runtime/pi.version \
    && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && cd /opt/rxn-skills \
    && npm install --no-audit --no-fund --omit=dev "$NODE_PACKAGE" "$PI_PACKAGE" "$TYPEBOX_PACKAGE" \
    && PATH=/opt/rxn-skills/node_modules/node/bin:$PATH /opt/rxn-skills/node_modules/.bin/pi --version \
    && ln -sf /opt/rxn-skills/node_modules/node/bin/node /usr/local/bin/node \
    && node --version

# The payload. Ground-truth-looking files are removed defensively, as the benchmark image does.
COPY . /opt/rxn-skills/
RUN find /opt/rxn-skills -type f \
      \( -iname 'gt.json' -o -iname '*ground*truth*' -o -iname '*answer*key*' \) \
      -delete \
    && test -f /opt/rxn-skills/scripts/run_chem_mcp.py \
    && test -d /opt/rxn-skills/skills/reaction-extract \
    && test -d /opt/rxn-skills/third_party/molecular_assembly \
    && test -f /opt/rxn-skills/prompts/execution_contract.txt \
    && cd /opt/rxn-skills \
    && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256 \
    && sha256sum -c MANIFEST.sha256 >/dev/null

ENV PATH="/opt/rxn-skills/node_modules/node/bin:${PATH}" \
    PYTHONPATH=/opt/rxn-skills \
    CHEMRXN_SKILLS=reaction-extract \
    RXNMINER_ROOT=/opt/rxn-skills \
    HOME=/root
RUN install -d /app /out
WORKDIR /app
ENTRYPOINT ["python3", "/opt/rxn-skills/bin/rxnminer"]
CMD ["check"]
