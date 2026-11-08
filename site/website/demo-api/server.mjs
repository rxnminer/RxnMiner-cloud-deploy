import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qwenConfig } from "./model-config.mjs";
import { createHarnessBackend } from "./harness-backend.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "RxnMiner/runtime/pi-service/test/fixtures/figure/demo-figure");
const port = Number.parseInt(process.env.RXNMINER_DEMO_API_PORT ?? "4322", 10);
const runtime = (process.env.RXNMINER_DEMO_RUNTIME_URL ?? "http://127.0.0.1:4310").replace(/\/+$/, "");
const runtimeToken = process.env.CHEMRXN_PI_INTERNAL_TOKEN ?? "";
const mode = process.env.RXNMINER_DEMO_MODE ?? "sample";
const molparserPrice = Number.isFinite(Number(process.env.RXNMINER_DEMO_MOLPARSER_PER_FIGURE_USD))
  ? Number(process.env.RXNMINER_DEMO_MOLPARSER_PER_FIGURE_USD) : null;
const jobs = new Map();
const limits = new Map();
const models = JSON.parse(process.env.RXNMINER_DEMO_MODELS_JSON ?? JSON.stringify([qwenConfig()]));

export function createDemoApiServer(options = {}) {
  const state = options.jobs ?? jobs;
  const configuredMode = options.mode ?? mode;
  const configuredRuntime = options.runtimeUrl ?? runtime;
  const token = options.runtimeToken ?? runtimeToken;
  const catalog = options.models ?? models;
  const harness = process.env.RXNMINER_DEMO_HARNESS_ROOT ? createHarnessBackend({
    root: process.env.RXNMINER_DEMO_HARNESS_ROOT,
    python: process.env.RXNMINER_DEMO_PYTHON,
    dataRoot: process.env.RXNMINER_DEMO_DATA_ROOT ?? path.join(root, ".local/harness-jobs"),
    catalog,
  }) : null;
  return createServer(async (request, response) => {
    if (!cors(request, response)) return send(response, 403, { error: "Origin not allowed." });
    if (request.method === "OPTIONS") { response.writeHead(204); return response.end(); }
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (harness && !url.pathname.startsWith("/api/demo/sample")) {
        if (url.pathname === "/api/demo/health") return send(response, 200, { liveAvailable: await harness.ready(), sampleAvailable: true });
        if (url.pathname === "/api/demo/models") {
          const live = await harness.ready();
          return send(response, 200, { live, defaultModel: catalog[0]?.id,
            models: catalog.map(m => ({ id: m.id, provider: m.provider, label: m.label, default: m.default, available: live })) });
        }
        if (url.pathname === "/api/demo/run" && request.method === "POST") {
          if (!localOrHttps(request)) throw error(400, "HTTPS_REQUIRED", "API keys require HTTPS.");
          const release = takeSlot(clientIp(request));
          if (!release) return send(response, 429, { error: "Demo concurrency or daily limit reached." });
          try { return send(response, 202, await harness.start(await readJson(request), release)); }
          catch (caught) { release(); throw caught; }
        }
        const match = url.pathname.match(/^\/api\/demo\/jobs\/([a-f0-9-]{36})(?:\/(result|events|artifacts)(?:\/([a-z]+))?)?$/);
        if (match && request.method === "DELETE") return send(response, harness.cancel(match[1]) ? 200 : 404, { deleted: true });
        if (match && request.method === "GET") {
          if (match[2] === "artifacts") {
            const file = await harness.artifact(match[1], match[3]);
            if (!file) return send(response, 404, { error: "Artifact unavailable." });
            response.writeHead(200, { "content-type": file.mediaType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
            return response.end(file.bytes);
          }
          const data = await harness.get(match[1], match[2] === "result");
          return send(response, data ? 200 : 404, data ?? { error: "Run not found." });
        }
        return send(response, 404, { error: "Demo route not found." });
      }
      if (url.pathname === "/api/demo/health" && request.method === "GET") {
        return send(response, 200, { sampleAvailable: true, liveAvailable: configuredMode === "live" && Boolean(token) });
      }
      if (url.pathname === "/api/demo/models" && request.method === "GET") {
        const live = (await runtimeHealth(configuredMode, configuredRuntime, token)).ready;
        return send(response, 200, {
          models: await Promise.all(catalog.map(async (item) => {
            let available = false;
            if (live) {
              try {
                const resolved = await call(configuredRuntime, token, "demo-model-catalog", "/v1/models/resolve", {
                  method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ provider: item.provider, modelId: item.id, requireImage: true }),
                });
                available = resolved.ok && (await resolved.json()).supportsImages === true;
              } catch { /* Keep offline models selectable for inspection. */ }
            }
            return { provider: item.provider, id: item.id, label: item.label, default: item.default, pricing: item.pricing, available };
          })),
          defaultModel: catalog.find((item) => item.default)?.id ?? catalog[0]?.id,
          live,
        });
      }
      if (url.pathname === "/api/demo/sample" && request.method === "GET") return send(response, 200, await loadSample());
      if (url.pathname === "/api/demo/sample/figure" && request.method === "GET") {
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        return response.end(await readFile(path.join(fixture, "image.png")));
      }
      if (url.pathname === "/api/demo/run" && request.method === "POST") {
        if (!localOrHttps(request)) throw error(400, "HTTPS_REQUIRED", "API keys require HTTPS.");
        const release = takeSlot(clientIp(request));
        if (!release) return send(response, 429, { error: "The demo limit for this network has been reached." });
        let stagedId = "";
        const userId = `demo-${randomBytes(18).toString("hex")}`;
        try {
          if (configuredMode !== "live" || !token) throw error(503, "LIVE_DEMO_UNAVAILABLE", "Live extraction is not configured on this service yet.");
          const body = await readJson(request);
          const model = catalog.find((item) => item.provider === body.provider && item.id === body.modelId);
          if (!model) throw error(400, "MODEL_NOT_ALLOWED", "Choose a model from the list.");
          if (body.acceptProviderBilling !== true) throw error(400, "BILLING_CONFIRMATION_REQUIRED", "Confirm provider billing first.");
          const modelApiKey = key(body.modelApiKey, "model");
          const uniParserApiKey = key(body.uniparserApiKey, "UniParser");
          const resolvedModel = await call(configuredRuntime, token, "demo-model-catalog", "/v1/models/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: model.provider, modelId: model.id, requireImage: true }),
          });
          if (!resolvedModel.ok || (await resolvedModel.json()).supportsImages !== true) {
            throw error(409, "MODEL_OFFLINE", "This model is not available for image extraction right now.");
          }
          const image = decodeImage(body);
          const staged = await call(configuredRuntime, token, userId, "/v1/input-artifacts", {
            method: "POST",
            headers: { "content-type": image.mediaType, "x-chemrxn-input-kind": "figure", "x-chemrxn-file-name": encodeURIComponent(fileName(body.fileName)) },
            body: image.bytes,
          });
          if (!staged.ok) throw error(503, "INPUT_STAGE_FAILED", "The figure could not be staged.");
          const artifact = (await staged.json()).artifact;
          stagedId = artifact.id;
          const started = await call(configuredRuntime, token, userId, "/v1/local-agent-sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              userId, jobId: `public-demo:${randomBytes(8).toString("hex")}`, contextMode: "figure",
              workspaceId: `demo-${randomBytes(8).toString("hex")}`, provider: model.provider, modelId: model.id,
              thinkingLevel: "medium", authMode: "api_key", apiKey: modelApiKey,
              uniparserApiKey: uniParserApiKey, queue: false,
              inputs: [{ artifactId: artifact.id, kind: "figure" }], startExtraction: true,
              initialMessage: "Extract every reaction. Preserve MolParser E-SMILES 2.0 strings byte-for-byte, including <sep> and extensions. Never canonicalize or rewrite E-SMILES.",
            }),
          });
          if (!started.ok) throw error(503, "EXTRACTION_START_FAILED", "The extraction could not be started.");
          const session = (await started.json()).session;
          const job = { id: session.id, userId, model, artifactId: artifact.id, release, lastSeq: 0, events: [] };
          job.timer = setTimeout(() => {
            void deleteInput(configuredRuntime, token, userId, artifact.id).catch(() => {});
            state.delete(job.id);
            release();
          }, 60 * 60 * 1000);
          job.timer.unref();
          state.set(session.id, job);
          return send(response, 202, { jobId: session.id, model: { id: model.id, label: model.label } });
        } catch (caught) {
          if (stagedId) await deleteInput(configuredRuntime, token, userId, stagedId).catch(() => {});
          release();
          throw caught;
        }
      }
      const artifactMatch = url.pathname.match(/^\/api\/demo\/jobs\/([A-Za-z0-9-]{36})\/artifacts\/([A-Za-z0-9._:-]+)$/);
      if (artifactMatch && request.method === "GET") {
        const job = state.get(artifactMatch[1]);
        if (!job) return send(response, 404, { error: "Demo run not found." });
        const rawResponse = await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/result`);
        if (!rawResponse.ok) return send(response, 409, { error: "The extraction result is not ready." });
        const raw = await rawResponse.json();
        const artifact = raw.manifest?.artifacts?.find((item) => item.id === artifactMatch[2]);
        if (!artifact) return send(response, 404, { error: "Artifact not found." });
        const file = await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/artifacts/${encodeURIComponent(artifact.id)}`);
        if (!file.ok) return send(response, 404, { error: "Artifact not found." });
        response.writeHead(200, { "content-type": artifact.mediaType, "content-security-policy": "sandbox; default-src 'none'", "content-disposition": "attachment", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
        return response.end(Buffer.from(await file.arrayBuffer()));
      }
      const match = url.pathname.match(/^\/api\/demo\/jobs\/([A-Za-z0-9-]{36})(?:\/(result|events))?$/);
      if (match && request.method === "GET") {
        const job = state.get(match[1]);
        if (!job) return send(response, 404, { error: "Demo run not found." });
        const sessionResponse = await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}`);
        if (!sessionResponse.ok) return send(response, 503, { error: "The runtime is unavailable." });
        const session = await sessionResponse.json();
        if (["ready", "failed", "cancelled", "interrupted", "aborted"].includes(session.status)) job.release();
        const eventResponse = await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/events?after=${job.lastSeq}`);
        const fresh = eventResponse.ok ? ((await eventResponse.json()).events ?? []) : [];
        job.events.push(...fresh); job.lastSeq = Math.max(job.lastSeq, ...fresh.map((event) => event.seq ?? 0));
        const safe = fresh.map(safeEvent);
        if (match[2] === "events") return send(response, 200, { status: session.status, events: safe });
        if (match[2] === "result" && ["review_ready", "partial"].includes(session.status)) {
          if (!job.result) {
            const raw = await (await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/result`)).json();
            const runUsage = usage(job.events);
            job.result = {
              terminalStatus: raw.terminalStatus,
              manifest: publicManifest(raw.manifest, job.id),
              usage: runUsage,
              model: job.model.id,
              billing: {
                chargedBy: "your_provider_accounts",
                modelEstimatedUsd: modelCost(runUsage, job.model.pricing),
                molparserEstimatedUsd: molparserPrice === null ? null : runUsage.molparserCalls * molparserPrice,
                currency: "USD",
                note: "Configured estimates only; final charges are set by provider accounts.",
              },
            };
            const predictionRef = raw.manifest?.artifacts?.find((item) => item.kind === "prediction_v2");
            if (predictionRef) {
              const predictionResponse = await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/artifacts/${encodeURIComponent(predictionRef.id)}`);
              if (predictionResponse.ok) {
                job.result.prediction = redactPrediction(JSON.parse(await predictionResponse.text()));
              }
            }
            job.release();
          }
          return send(response, 200, job.result);
        }
        return send(response, 200, { status: session.status, stage: session.status, usage: usage(job.events), events: safe });
      }
      if (match && request.method === "DELETE") {
        const job = state.get(match[1]);
        if (!job) return send(response, 404, { error: "Demo run not found." });
        await call(configuredRuntime, token, job.userId, `/v1/sessions/${job.id}/abort`, { method: "POST" }).catch(() => {});
        await deleteInput(configuredRuntime, token, job.userId, job.artifactId);
        if (job.timer) clearTimeout(job.timer);
        state.delete(job.id); job.release();
        return send(response, 200, { deleted: true });
      }
      return send(response, 404, { error: "Demo route not found." });
    } catch (caught) {
      const status = Number.isInteger(caught?.status) ? caught.status : 500;
      return send(response, status, { code: caught?.code ?? "DEMO_FAILED", error: caught?.message ?? "Demo request failed." });
    }
  });
}

async function loadSample() {
  const [fixtureData, prediction, perception, attribution] = await Promise.all([
    readFile(path.join(fixture, "fixture.json"), "utf8").then(JSON.parse),
    readFile(path.join(fixture, "pred.v2.json"), "utf8").then(JSON.parse),
    readFile(path.join(fixture, "molparser.json"), "utf8").then(JSON.parse),
    readFile(path.join(fixture, "ATTRIBUTION.md"), "utf8"),
  ]);
  return { mode: "recorded_replay", reconstructed: true, model: fixtureData.model, figureUrl: "/api/demo/sample/figure", prediction, perception, attribution };
}
async function runtimeHealth(configuredMode, base, token) {
  if (configuredMode !== "live" || !token) return { ready: false };
  try {
    const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1_500) });
    const health = await response.json();
    return {
      ready: response.ok && health.status === "ok" && health.interactivePiBackend !== "not_connected",
    };
  } catch {
    return { ready: false };
  }
}
async function call(base, token, userId, route, init = {}) {
  return fetch(`${base}${route}`, { ...init, headers: { authorization: `Bearer ${token}`, "x-chemrxn-user-id": userId, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
}
async function deleteInput(base, token, userId, id) { return call(base, token, userId, `/v1/input-artifacts/${encodeURIComponent(id)}`, { method: "DELETE" }); }
function key(value, label) { if (typeof value !== "string" || value.length < 8 || value.length > 16_384 || /\s/.test(value)) throw error(400, "API_KEY_REQUIRED", `Enter a valid ${label} API key.`); return value; }
function decodeImage(body) { const match = typeof body.imageData === "string" && body.imageData.match(/^data:(image\/(?:png|jpeg|webp|tiff));base64,([A-Za-z0-9+/=]+)$/); if (!match) throw error(400, "INVALID_FIGURE", "Use PNG, JPEG, WebP, or TIFF."); const bytes = Buffer.from(match[2], "base64"); if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw error(413, "FIGURE_TOO_LARGE", "Figure must be 5 MiB or smaller."); return { mediaType: match[1], bytes }; }
function fileName(value) { return path.basename(typeof value === "string" ? value : "reaction-figure").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) || "reaction-figure"; }
function safeEvent(event) { return { seq: event.seq, at: event.at, phase: event.data?.phase, type: event.data?.event?.type, tool: event.data?.event?.toolName }; }
function usage(events) { const result = { input: 0, output: 0, modelCalls: 0, molparserCalls: 0 }; for (const event of events) { const pi = event.data?.event; if (pi?.type === "tool_execution_end" && ["detect", "ocsr_detect"].includes(pi.toolName)) result.molparserCalls++; if (pi?.type === "message_end" && pi.message?.role === "assistant") { result.input += pi.message.usage?.input ?? pi.message.usage?.inputTokens ?? 0; result.output += pi.message.usage?.output ?? pi.message.usage?.outputTokens ?? 0; result.modelCalls++; } } return result; }
function publicManifest(manifest, jobId) {
  const value = manifest && typeof manifest === "object" ? manifest : {};
  return {
    schemaVersion: value.schemaVersion, model: value.model, counts: value.counts,
    cache: value.cache, validation: value.validation, reactions: value.reactions,
    molecules: value.molecules, bboxes: value.bboxes,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind, sha256: artifact.sha256, mediaType: artifact.mediaType,
      url: `/api/demo/jobs/${jobId}/artifacts/${encodeURIComponent(artifact.id)}`,
    })) : [],
  };
}
function modelCost(usage, pricing) {
  if (!pricing || pricing.inputPerMillionUsd == null || pricing.outputPerMillionUsd == null) return null;
  return (
    usage.input * pricing.inputPerMillionUsd
    + usage.output * pricing.outputPerMillionUsd
    + (usage.cacheRead ?? 0) * (pricing.cacheReadPerMillionUsd ?? pricing.inputPerMillionUsd)
    + (usage.cacheWrite ?? 0) * (pricing.cacheWritePerMillionUsd ?? pricing.inputPerMillionUsd)
  ) / 1_000_000;
}
function redactPrediction(value, depth = 0) {
  if (depth > 18) return null;
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => redactPrediction(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !/(?:api.?key|token|secret|password|credential|(?:^|_)(?:absolute_)?path$|workspace|locator)/i.test(name))
    .slice(0, 2_000)
    .map(([name, item]) => [name, redactPrediction(item, depth + 1)]));
}
function cors(request, response) { const origin = request.headers.origin; if (!origin) return true; const allowed = new Set(["http://localhost:4321", "http://127.0.0.1:4321", ...(process.env.RXNMINER_DEMO_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)]); if (!allowed.has(origin)) return false; response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS"); response.setHeader("Access-Control-Allow-Headers", "Content-Type"); return true; }
function localOrHttps(request) { const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? ""); return local || request.socket.encrypted || (process.env.RXNMINER_DEMO_TRUST_PROXY === "true" && request.headers["x-forwarded-proto"] === "https"); }
function clientIp(request) { return request.socket.remoteAddress ?? "unknown"; }
function takeSlot(ip) {
  const dailyLimit = Number(process.env.RXNMINER_DEMO_MAX_RUNS_PER_IP ?? 8);
  const activeLimit = Number(process.env.RXNMINER_DEMO_MAX_ACTIVE_PER_IP ?? 2);
  const current = limits.get(ip) ?? { day: Date.now(), runs: 0, active: 0 };
  if (Date.now() - current.day > 86_400_000) { current.day = Date.now(); current.runs = 0; }
  if (current.runs >= dailyLimit || current.active >= activeLimit) return undefined;
  current.runs++; current.active++; limits.set(ip, current);
  let released = false;
  return () => { if (released) return; released = true; current.active = Math.max(0, current.active - 1); };
}
function error(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function send(response, status, value) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(value)); }
async function readJson(request) { const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw error(413, "REQUEST_TOO_LARGE", "Request too large."); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw error(400, "INVALID_JSON", "JSON body required."); } }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDemoApiServer();
  server.listen(port, process.env.RXNMINER_DEMO_BIND ?? "127.0.0.1", () => console.log(`RxnMiner demo API on http://127.0.0.1:${port} (${mode})`));
}
