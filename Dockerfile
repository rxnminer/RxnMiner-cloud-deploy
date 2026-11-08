FROM node:22.19.0-bookworm AS nodebase
FROM python:3.11-bookworm
COPY --from=nodebase /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebase /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:/opt/harness/node_modules/node/bin:${PATH}" PIP_INDEX_URL=https://pypi.org/simple/
RUN pip install --no-cache-dir rdkit==2022.9.5 numpy==1.26.4 scipy==1.14.1 Pillow==12.3.0 requests==2.32.5 PyMuPDF==1.26.4 opencv-python-headless==4.10.0.84
COPY sdk/uniparser_tools/ /opt/venv/lib/python3.11/site-packages/uniparser_tools/
COPY harness/ /opt/harness/
RUN cd /opt/harness && npm install --registry=https://registry.npmjs.org --no-audit --no-fund node@22.19.0 @earendil-works/pi-coding-agent@0.82.1 typebox@1.1.38
COPY site/ /opt/site/
RUN npm --prefix /opt/site/website ci --registry=https://registry.npmjs.org --no-audit --no-fund \
    && PUBLIC_DEMO_API_URL=/api/demo npm --prefix /opt/site/website run build \
    && node /opt/site/website/demo-api/configure-harness.mjs /opt/harness \
    && python -c "from rdkit import rdBase; from uniparser_tools.api.clients import UniParserClient; assert rdBase.rdkitVersion == '2022.09.5'"
ENV RXNMINER_DEMO_HARNESS_ROOT=/opt/harness RXNMINER_DEMO_PYTHON=/opt/venv/bin/python RXNMINER_DEMO_DATA_ROOT=/data/jobs RXNMINER_DEMO_API_PORT=18842 RXNMINER_DEMO_BIND=127.0.0.1 RXNMINER_DEMO_MAX_CONCURRENT=4
WORKDIR /opt/site
EXPOSE 18840
CMD ["node", "deploy/cloud/launch.mjs"]

