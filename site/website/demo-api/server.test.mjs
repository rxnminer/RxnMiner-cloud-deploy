import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createDemoApiServer } from './server.mjs';
import { qwenConfig, piModelCatalog } from './model-config.mjs';

test('demo and runtime share the exact Qwen model ID and configurable endpoint without keys', () => {
  const defaults = qwenConfig({});
  assert.equal(defaults.id, 'Qwen3.8-Flash-Next-FP8');
  assert.equal(defaults.baseUrl, 'http://192.168.198.191:8015/v1');
  const custom = piModelCatalog({ Q38_MODEL: 'other', Q38_BASE_URL: 'http://localhost:1234/v1', Q38_API_KEY: 'do-not-persist' });
  assert.equal(custom.providers['openai-compatible'].models[0].id, 'other');
  assert.equal(custom.providers['openai-compatible'].baseUrl, 'http://localhost:1234/v1');
  assert.ok(!JSON.stringify(custom).includes('do-not-persist'));
});

async function listen(server, t) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('sample returns the complete original prediction including E-SMILES evidence', async t => {
  const base = await listen(createDemoApiServer({ mode: 'sample' }), t);
  const sample = await (await fetch(`${base}/api/demo/sample`)).json();
  const original = JSON.parse(await readFile(new URL('../../RxnMiner/runtime/pi-service/test/fixtures/figure/demo-figure/pred.v2.json', import.meta.url)));
  assert.deepEqual(sample.prediction, original);
  assert.equal(sample.prediction.selected_examples.length, 24);
  const image = await fetch(`${base}${sample.figureUrl}`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok((await image.arrayBuffer()).byteLength > 1000);
});
test('catalog keeps offline models visible without exposing backend configuration', async t => {
  const base = await listen(createDemoApiServer({
    mode: 'sample', models: [{ provider: 'local', id: 'vision', label: 'Vision', apiKey: 'private', default: true }],
  }), t);
  const catalog = await (await fetch(`${base}/api/demo/models`)).json();
  assert.equal(catalog.models[0].id, 'vision');
  assert.equal(catalog.models[0].available, false);
  assert.equal(catalog.models[0].apiKey, undefined);
});
test('live catalog checks each allowlisted model for vision support', async t => {
  const backend = await listen(createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/healthz') return res.end(JSON.stringify({ status: 'ok', interactivePiBackend: 'connected' }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(body.requireImage, true);
    res.end(JSON.stringify({ supportsImages: body.modelId === 'vision' }));
  }), t);
  const base = await listen(createDemoApiServer({
    mode: 'live', runtimeUrl: backend, runtimeToken: 'test-token',
    models: [{ provider: 'local', id: 'vision' }, { provider: 'local', id: 'text' }],
  }), t);
  const catalog = await (await fetch(`${base}/api/demo/models`)).json();
  assert.deepEqual(catalog.models.map(m => m.available), [true, false]);
});
test('a failed live start cleans up staged input and preserves the original error', async t => {
  let deleted = false;
  const backend = await listen(createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models/resolve') return res.end('{"supportsImages":true}');
    if (req.url === '/v1/input-artifacts' && req.method === 'POST') return res.end('{"artifact":{"id":"staged"}}');
    if (req.url === '/v1/input-artifacts/staged' && req.method === 'DELETE') {
      deleted = true; return res.end('{}');
    }
    res.statusCode = 503; res.end('{}');
  }), t);
  const base = await listen(createDemoApiServer({
    mode: 'live', runtimeUrl: backend, runtimeToken: 'test-token',
    models: [{ provider: 'local', id: 'vision' }],
  }), t);
  const response = await fetch(`${base}/api/demo/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'local', modelId: 'vision', acceptProviderBilling: true,
      modelApiKey: 'test-model-key', uniparserApiKey: 'test-parser-key',
      imageData: 'data:image/png;base64,aGVsbG8=',
    }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'EXTRACTION_START_FAILED');
  assert.equal(deleted, true);
});
