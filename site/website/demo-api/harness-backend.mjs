import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateBilling, pricingConfig } from './billing.mjs';

const wrapper = fileURLToPath(new URL('./harness-run.py', import.meta.url));
const publicArtifacts = {
  figure: ['figure', 'image/png', 'input_figure'],
  prediction: ['result/answer.json', 'application/json', 'prediction_v2'],
  review: ['result/review.png', 'image/png', 'reaction_render'],
};

async function reviewPath(directory) {
  await access(path.join(directory, 'result/answer.json'));
  for (const stem of ['result/review', 'workspace/review', 'workspace/answer.view']) {
    try {
      await Promise.all(['.html', '.png'].map(ext => access(path.join(directory, stem + ext))));
      return stem + '.png';
    } catch { /* The native renderer may use answer.view.* by default. */ }
  }
  // A completed no-reaction result has nothing to draw. Do not apply this
  // exception to missing/malformed predictions or nonempty chemistry results.
  const prediction = JSON.parse(await readFile(path.join(directory, 'result/answer.json'), 'utf8'));
  const recognition = await readFile(path.join(directory, 'recognition.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (Array.isArray(prediction.selected_examples) && prediction.selected_examples.length === 0
      && Array.isArray(prediction.reaction_templates) && prediction.reaction_templates.length === 0
      && recognition?.molecules === 0) return null;
  throw new Error('Final rendered review is missing.');
}

export function createHarnessBackend({ root, python, dataRoot, catalog, launch = spawn, maxConcurrent = Number(process.env.RXNMINER_DEMO_MAX_CONCURRENT ?? 4) }) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  async function restore(id) {
    if (jobs.has(id)) return jobs.get(id);
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    try {
      const directory = path.join(dataRoot, id);
      const saved = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8'));
      const run = JSON.parse(await readFile(path.join(directory, 'result/run.json'), 'utf8'));
      const review = await reviewPath(directory);
      if (!run.answer_complete || !run.answer_present || run.pi_rc !== 0) return null;
      const job = { id, directory, review, pricing: saved.pricing ?? pricingConfig({}), model: saved.model, mediaType: saved.mediaType,
        status: 'review_ready', release: () => {},
        summary: { elapsedSeconds: run.elapsed_sec, completedSteps: run.completed_steps,
          lastStopReason: run.last_stop_reason, answerComplete: true } };
      jobs.set(id, job);
      return job;
    } catch { return null; }
  }
  async function ready() {
    try {
      await Promise.all(['bin/rxnminer', 'pi-extension/index.ts', 'node_modules/.bin/pi']
        .map(file => access(path.join(root, file))));
      await access(python);
      return true;
    } catch { return false; }
  }
  async function telemetry(job) {
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, modelCalls: 0, molparserCalls: 0 };
    let coverage = true;
    const addUsage = value => {
      if (!value || !Number.isFinite(value.input) || !Number.isFinite(value.output)) { coverage = false; return; }
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) usage[key] += value[key] ?? 0;
    };
    let compactions = 0;
    let stage = job.status;
    try {
      const sessions = path.join(job.directory, 'result/pi-agent-dir/sessions');
      for (const name of await readdir(sessions)) {
        if (!name.endsWith('.jsonl')) continue;
        const text = await readFile(path.join(sessions, name), 'utf8');
        for (const line of text.split('\n')) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'compaction') { compactions++; addUsage(event.usage); }
          if (event.type === 'branch_summary') addUsage(event.usage);
          const message = event.message;
          if (message?.role === 'assistant') {
            usage.modelCalls++;
            addUsage(message.usage);
            for (const block of message.content ?? []) {
              if (block.type === 'toolCall') stage = block.name;
            }
          }
          if (message?.role === 'toolResult' && ['detect', 'ocsr_detect'].includes(message.toolName))
            usage.molparserCalls++;
        }
      }
    } catch { coverage = false; }
    let recognition = null;
    try { recognition = JSON.parse(await readFile(path.join(job.directory, 'recognition-usage.json'), 'utf8')); } catch { /* Historical calls were not metered. */ }
    return { usage, compactions, billing: estimateBilling(usage, recognition, job.pricing ?? pricingConfig({}), coverage),
      stage: job.status === 'running' ? stage : job.status };
  }
  return {
    ready,
    async start(body, release) {
      if (!await ready()) throw new Error('RxnMiner harness is not installed.');
      const model = catalog.find(m => m.id === body.modelId && m.provider === body.provider);
      if (!model) throw new Error('Choose an allowlisted model.');
      if (body.acceptProviderBilling !== true) throw new Error('Confirm provider billing first.');
      for (const key of [body.modelApiKey, body.uniparserApiKey]) {
        if (typeof key !== 'string' || key.length < 8 || key.length > 16384 || /\s/.test(key))
          throw new Error('Valid model and UniParser API keys are required.');
      }
      const image = /^data:(image\/(?:png|jpeg|webp|tiff));base64,([A-Za-z0-9+/=]+)$/.exec(body.imageData ?? '');
      if (!image) throw new Error('A supported image is required.');
      const bytes = Buffer.from(image[2], 'base64');
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Figure must be 5 MiB or smaller.');
      const id = randomUUID();
      const directory = path.join(dataRoot, id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const imagePath = path.join(directory, 'figure');
      await writeFile(imagePath, bytes, { mode: 0o600 });
      const job = { id, directory, pricing: pricingConfig(), model: model.id, status: 'queued', release, mediaType: image[1] };
      await writeFile(path.join(directory, 'job.json'),
        JSON.stringify({ model: model.id, mediaType: image[1], pricing: job.pricing }), { mode: 0o600 });
      jobs.set(id, job);
      job.launch = () => {
        if (job.status === 'cancelled') return;
        active++;
        job.status = 'running';
        // No shell interpolation and no credentials in argv, response, or persisted configuration.
        job.child = launch(python, [wrapper, root, imagePath, directory], {
          detached: process.platform !== 'win32', stdio: 'ignore',
          env: {
            ...process.env, OPENAI_BASE_URL: model.baseUrl,
            OPENAI_API_KEY: body.modelApiKey, UNIPARSER_API_KEY: body.uniparserApiKey,
            RXNMINER_BASE_URL: model.baseUrl, RXNMINER_API_KEY: body.modelApiKey,
            Q38_MODEL: model.id,
          },
        });
        job.child.on('error', () => { job.status = 'failed'; active--; release(); launchNext(); });
        job.child.on('exit', async code => {
          active--;
          launchNext();
        if (job.status === 'cancelled') return;
        try {
          const run = JSON.parse(await readFile(path.join(directory, 'result/run.json'), 'utf8'));
          let artifactsReady = false;
          try {
            job.review = await reviewPath(directory);
            artifactsReady = true;
          } catch { /* A complete run must have its actual review artifacts. */ }
          job.status = code === 0 && run.answer_complete && run.answer_present && artifactsReady ? 'review_ready' : 'failed';
          job.summary = {
            elapsedSeconds: run.elapsed_sec, completedSteps: run.completed_steps,
            lastStopReason: run.last_stop_reason, answerComplete: run.answer_complete,
          };
        } catch { job.status = 'failed'; }
        release();
        });
      };
      queue.push(job);
      launchNext();
      return { jobId: id, model: { id: model.id, label: model.label }, queued: job.status === 'queued', position: queue.indexOf(job) + 1 };
    },
    async get(id, result = false) {
      const job = await restore(id);
      if (!job) return null;
      const stats = await telemetry(job);
      if (!result || job.status !== 'review_ready')
        return { status: job.status, ...stats, harness: 'RxnMiner-dev/bin/rxnminer', summary: job.summary };
      const prediction = JSON.parse(await readFile(path.join(job.directory, 'result/answer.json'), 'utf8'));
      return {
        terminalStatus: 'review_ready', model: job.model, prediction, ...stats, summary: job.summary,
        manifest: { artifacts: Object.entries(publicArtifacts).filter(([key]) => key !== 'review' || job.review).map(([key, [, mediaType, kind]]) => ({
          id: key, kind, mediaType: key === 'figure' ? job.mediaType : mediaType,
          url: `/api/demo/jobs/${id}/artifacts/${key}`,
        })) },
      };
    },
    async artifact(id, key) {
      const job = await restore(id), entry = publicArtifacts[key];
      if (!job || !entry || (key !== 'figure' && job.status !== 'review_ready')) return null;
      if (key === 'review' && !job.review) return null;
      try {
        return { bytes: await readFile(path.join(job.directory, key === 'review' ? job.review : entry[0])),
          mediaType: key === 'figure' ? job.mediaType : entry[1] };
      } catch { return null; }
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job) return false;
      if (job.status === 'queued') {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.status = 'cancelled';
        job.release();
        return true;
      }
      if (job.status === 'running') {
        try {
          if (process.platform !== 'win32') process.kill(-job.child.pid, 'SIGTERM');
          else job.child.kill('SIGTERM');
        } catch { /* Already exited. */ }
      }
      job.status = 'cancelled';
      job.release();
      return true;
    },
  };
  function launchNext() {
    while (active < Math.max(1, maxConcurrent) && queue.length) {
      const next = queue.shift();
      if (next?.status === 'queued') next.launch();
    }
  }
}
