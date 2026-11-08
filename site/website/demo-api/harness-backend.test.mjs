import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHarnessBackend } from './harness-backend.mjs';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rxnminer-harness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['bin/rxnminer', 'pi-extension/index.ts', 'node_modules/.bin/pi', 'python']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '');
  }
  let launched;
  const child = new EventEmitter();
  const backend = createHarnessBackend({
    root, python: path.join(root, 'python'), dataRoot: path.join(root, 'jobs'),
    catalog: [{ provider: 'openai-compatible', id: 'qwen', baseUrl: 'http://model.test/v1' }],
    launch: (...args) => { launched = args; return child; },
  });
  return { root, backend, child, launch: () => launched };
}
const body = () => ({
  provider: 'openai-compatible', modelId: 'qwen', acceptProviderBilling: true,
  modelApiKey: 'test-model-secret', uniparserApiKey: 'test-parser-secret',
  imageData: 'data:image/png;base64,aGVsbG8=',
});
test('harness boundary supplies keys only in environment and serves the original complete JSON', async t => {
  const s = await setup(t);
  let released = 0;
  const job = await s.backend.start(body(), () => released++);
  const [python, args, options] = s.launch();
  assert.equal(python, path.join(s.root, 'python'));
  assert.ok(args[0].endsWith('harness-run.py'));
  assert.equal(args[1], s.root);
  assert.ok(!JSON.stringify(args).includes('secret'));
  assert.equal(options.env.OPENAI_API_KEY, 'test-model-secret');
  assert.equal(options.env.UNIPARSER_API_KEY, 'test-parser-secret');
  assert.ok(!(await readFile(path.join(s.root, 'jobs', job.jobId, 'job.json'), 'utf8')).includes('secret'));
  assert.equal((await s.backend.get(job.jobId)).status, 'running');
  const resultDir = path.join(s.root, 'jobs', job.jobId, 'result');
  await mkdir(resultDir, { recursive: true });
  const prediction = { selected_examples: [{ products: [{ 'E-SMILES': 'CO<sep>' }] }] };
  await writeFile(path.join(resultDir, 'answer.json'), JSON.stringify(prediction));
  await writeFile(path.join(resultDir, 'review.html'), '<html></html>');
  await writeFile(path.join(resultDir, 'review.png'), 'test image');
  await writeFile(path.join(resultDir, 'run.json'), JSON.stringify({
    answer_complete: true, answer_present: true, completed_steps: ['assemble', 'render_reactions'],
    last_stop_reason: 'stop', pi_rc: 0,
  }));
  s.child.emit('exit', 0);
  for (let i = 0; i < 100 && !released; i++) await new Promise(r => setTimeout(r, 5));
  const result = await s.backend.get(job.jobId, true);
  assert.equal(result.terminalStatus, 'review_ready');
  assert.deepEqual(result.prediction, prediction);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(await s.backend.artifact(job.jobId, '../run.json'), null);
  const restarted = createHarnessBackend({ root: s.root, python, dataRoot: path.join(s.root, 'jobs'), catalog: [] });
  assert.deepEqual((await restarted.get(job.jobId, true)).prediction, prediction);
});
test('an incomplete CLI answer is not presented as success', async t => {
  const s = await setup(t);
  let released = false;
  const job = await s.backend.start(body(), () => { released = true; });
  const resultDir = path.join(s.root, 'jobs', job.jobId, 'result');
  await mkdir(resultDir, { recursive: true });
  await writeFile(path.join(resultDir, 'run.json'), JSON.stringify({ answer_present: true, answer_complete: false }));
  s.child.emit('exit', 0);
  for (let i = 0; i < 100 && !released; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await s.backend.get(job.jobId, true)).status, 'failed');
  assert.equal(await s.backend.artifact(job.jobId, 'prediction'), null);
});
test('native answer.view artifacts complete a job and survive API restart', async t => {
  const s = await setup(t);
  let released = false;
  const job = await s.backend.start(body(), () => { released = true; });
  const directory = path.join(s.root, 'jobs', job.jobId);
  await mkdir(path.join(directory, 'result'));
  await mkdir(path.join(directory, 'workspace'));
  await writeFile(path.join(directory, 'result/answer.json'), '{"selected_examples":[]}');
  await writeFile(path.join(directory, 'result/run.json'), JSON.stringify({
    pi_rc: 0, answer_complete: true, answer_present: true,
    completed_steps: ['assemble', 'render_reactions'], last_stop_reason: 'stop',
  }));
  await writeFile(path.join(directory, 'workspace/answer.view.html'), '<html>review</html>');
  await writeFile(path.join(directory, 'workspace/answer.view.png'), 'native review');
  s.child.emit('exit', 0);
  for (let i = 0; i < 100 && !released; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await s.backend.get(job.jobId)).status, 'review_ready');
  const restarted = createHarnessBackend({ root: s.root, python: path.join(s.root, 'python'),
    dataRoot: path.join(s.root, 'jobs'), catalog: [] });
  assert.equal((await restarted.get(job.jobId)).status, 'review_ready');
  assert.equal((await restarted.artifact(job.jobId, 'review')).bytes.toString(), 'native review');
});
test('the harness backend bounds child processes and queues excess runs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rxnminer-harness-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['bin/rxnminer', 'pi-extension/index.ts', 'node_modules/.bin/pi', 'python']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '');
  }
  const children = [];
  const backend = createHarnessBackend({
    root, python: path.join(root, 'python'), dataRoot: path.join(root, 'jobs'),
    catalog: [{ provider: 'openai-compatible', id: 'qwen', baseUrl: 'http://model.test/v1' }],
    maxConcurrent: 1,
    launch: () => { const child = new EventEmitter(); children.push(child); return child; },
  });
  const release = () => {};
  const first = await backend.start(body(), release);
  const second = await backend.start(body(), release);
  assert.equal((await backend.get(first.jobId)).status, 'running');
  assert.equal((await backend.get(second.jobId)).status, 'queued');
  assert.equal(children.length, 1);
  children[0].emit('exit', 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(children.length, 2);
});

test('completed empty recognition is downloadable without review images, but failed runs are not', async t => {
  const s = await setup(t);
  let released = false;
  const job = await s.backend.start(body(), () => { released = true; });
  const directory = path.join(s.root, 'jobs', job.jobId);
  await mkdir(path.join(directory, 'result'));
  const empty = { selected_examples: [], reaction_templates: [] };
  await writeFile(path.join(directory, 'result/answer.json'), JSON.stringify(empty));
  await writeFile(path.join(directory, 'recognition.json'), '{"molecules":0}');
  await writeFile(path.join(directory, 'result/run.json'), JSON.stringify({
    pi_rc: 0, answer_complete: true, answer_present: true, last_stop_reason: 'stop',
  }));
  s.child.emit('exit', 0);
  for (let i = 0; i < 100 && !released; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal((await s.backend.get(job.jobId)).status, 'review_ready');
  const restarted = createHarnessBackend({ root: s.root, python: path.join(s.root, 'python'),
    dataRoot: path.join(s.root, 'jobs'), catalog: [] });
  const result = await restarted.get(job.jobId, true);
  assert.deepEqual(result.prediction, empty);
  assert.ok(!result.manifest.artifacts.some(a => a.id === 'review'));
  await writeFile(path.join(directory, 'result/run.json'), '{"pi_rc":1,"answer_complete":false,"answer_present":true}');
  const failed = createHarnessBackend({ root: s.root, python: path.join(s.root, 'python'),
    dataRoot: path.join(s.root, 'jobs'), catalog: [] });
  assert.equal(await failed.get(job.jobId), null);
});
