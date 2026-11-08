const root = document.querySelector('[data-demo-root]');
if (root) initialize(root);

function initialize(root) {
  const $ = (selector) => root.querySelector(selector);
  const api = root.dataset.apiBase.replace(/\/$/, '');
  const input = $('[data-image-input]');
  const modelSelect = $('[data-model-select]');
  const run = $('[data-run]');
  const sampleButton = $('[data-sample]');
  const download = $('[data-download]');
  const results = $('[data-stage-list]');
  const navigation = $('[data-reaction-navigation]');
  const figure = $('[data-figure]');
  const overlay = $('[data-source-overlay]');
  let prediction = null;
  let selectedReaction = 0;
  let catalog = [];
  let live = false;
  let busy = false;
  let renderGeneration = 0;
  let operation = 0;
  let figureObjectUrl;
  let exportName = 'rxnminer-result.json';
  let rdkitPromise;

  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const error = (message = '') => {
    $('[data-error]').textContent = message;
    $('[data-error]').hidden = !message;
  };
  const status = (message) => { $('[data-status]').textContent = message; };
  const records = () => prediction?.selected_examples ?? prediction?.reactions ?? [];
  const selectedModel = () => catalog[Number(modelSelect.value)];
  const updateRun = () => {
    root.dataset.running = String(busy);
    $('[data-run-activity]').hidden = !busy;
    run.textContent = busy ? 'Running…' : 'Run extraction';
    if (!busy) $('[data-run-label]').textContent = 'Running extraction';
    run.disabled = busy || !live || selectedModel()?.available !== true;
    sampleButton.disabled = busy;
    input.disabled = busy;
    modelSelect.disabled = busy || !catalog.length;
  };
  const showProgress = (current) => {
    $('[data-run-label]').textContent = current.status === 'queued' ? 'Queued · waiting for a worker' : 'Running extraction';
    $('[data-workspace-state]').textContent = String(current.stage || current.status).toUpperCase();
  };
  const showFigure = (src) => {
    figure.src = src;
    figure.hidden = false;
    $('[data-figure-empty]').hidden = true;
    overlay.replaceChildren();
  };
  const clearResults = () => {
    $('[data-billing-panel]').hidden = true;
    prediction = null;
    download.disabled = true;
    renderGeneration++;
    navigation.replaceChildren();
    overlay.replaceChildren();
    $('[data-reaction-count]').textContent = '';
    results.innerHTML = '<div class="empty-result">Your extraction results will appear here.</div>';
  };
  function showBilling(data) {
    const billing = data.billing;
    if (!billing?.lines) return;
    $('[data-billing-panel]').hidden = false;
    const money = value => value === null || value === undefined ? 'Unavailable' : `${escape(billing.currency)} ${Number(value).toFixed(6)}`;
    const price = (value, unit) => value === null || value === undefined ? 'Not configured' : `${money(value)} / ${unit}`;
    const labels = { input: 'Model · input', output: 'Model · output', cacheRead: 'Model · cache read', cacheWrite: 'Model · cache write' };
    const rows = billing.lines.map(line => `<tr><td>${labels[line.category]}</td><td>${Number(line.units).toLocaleString()} tokens</td><td>${price(line.unitPrice, '1M tokens')}</td><td>${money(line.estimatedCost)}</td></tr>`);
    const recognition = billing.recognition;
    rows.push(`<tr><td>UniParser</td><td>${recognition ? `${recognition.successfulImages} successful / ${recognition.attemptedImages} attempted images (${recognition.failedImages} failed)` : 'Not metered for this historical run'}</td><td>${price(billing.prices.uniparser, 'image')}</td><td>${money(billing.uniparserEstimatedCost)}</td></tr>`);
    $('[data-billing-details]').innerHTML = `<table><thead><tr><th>Service</th><th>Usage</th><th>Unit price</th><th>Estimate</th></tr></thead><tbody>${rows.join('')}</tbody></table><div class="billing-total"><strong>Total estimate</strong><strong>${money(billing.totalEstimatedCost)}</strong></div>`;
    $('[data-billing-note]').textContent = `${billing.modelUsageComplete ? 'Recorded model usage includes compaction when available. ' : 'Some model usage was not recorded; a complete cost cannot be calculated. '}${billing.note}`;
  }
  async function request(url, init) {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The request failed.');
    return data;
  }
  function loadRDKit() {
    if (!rdkitPromise) rdkitPromise = (async () => {
      const base = root.dataset.rdkitBase;
      if (typeof window.initRDKitModule !== 'function') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `${base}RDKit_minimal.js`;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Structure renderer could not load.'));
          document.head.append(script);
        });
      }
      return window.initRDKitModule({ locateFile: () => `${base}RDKit_minimal.wasm` });
    })();
    return rdkitPromise;
  }
  function rawOf(molecule) {
    return molecule['E-SMILES'] ?? molecule.esmiles ?? molecule.smiles ?? molecule.SMILES ?? '';
  }
  function conditionItems(value) {
    const items = [];
    const parseLooseList = (text, role) => {
      const matches = [...text.matchAll(/['"]role['"]\s*:\s*['"]([^'"]+)['"]\s*,\s*['"]text['"]\s*:\s*['"]([^'"]*)['"]/g)];
      if (!matches.length) return false;
      matches.forEach((match) => items.push({ role: match[1], text: match[2] }));
      return true;
    };
    const visit = (entry, inheritedRole = 'Condition') => {
      if (Array.isArray(entry)) return entry.forEach((item) => visit(item, inheritedRole));
      if (entry && typeof entry === 'object') {
        const role = typeof entry.role === 'string' ? entry.role : inheritedRole;
        const text = entry.text ?? entry.value ?? entry.smiles ?? entry['E-SMILES'];
        if (Array.isArray(text) || (text && typeof text === 'object')) return visit(text, role);
        if (typeof text === 'string') {
          const trimmed = text.trim();
          if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try { return visit(JSON.parse(trimmed), role); } catch { /* display as plain text */ }
          }
          if (parseLooseList(trimmed, role)) return;
        }
        if (text !== undefined && text !== null) return items.push({ role, text: String(text) });
        return Object.entries(entry).forEach(([key, item]) => visit(item, key));
      }
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
          try { return visit(JSON.parse(trimmed), inheritedRole); } catch { /* display as plain text */ }
        }
        if (parseLooseList(trimmed, inheritedRole)) return;
        if (trimmed) items.push({ role: inheritedRole, text: trimmed });
      }
    };
    visit(value);
    return items;
  }
  function moleculeCard(molecule, ordinal) {
    const raw = rawOf(molecule);
    return `<div class="visual-molecule" data-molecule="${ordinal}">
      <div class="structure-canvas" aria-label="Molecular structure">Drawing structure…</div>
      <div class="structure-label">${escape(molecule.identifier || `Molecule ${ordinal + 1}`)}</div>
      <details><summary>SMILES / E-SMILES</summary><code>${escape(raw || 'No structure supplied')}</code></details>
    </div>`;
  }
  function highlight(molecules) {
    overlay.replaceChildren();
    if (!figure.naturalWidth) return;
    overlay.setAttribute('viewBox', `0 0 ${figure.naturalWidth} ${figure.naturalHeight}`);
    const seen = new Set();
    for (const molecule of molecules) {
      const bbox = molecule._source?.bbox ?? molecule.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) continue;
      const [x0, y0, x1, y1] = bbox;
      if (x1 <= x0 || y1 <= y0 || seen.has(bbox.join(','))) continue;
      seen.add(bbox.join(','));
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [key, value] of Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }))
        rect.setAttribute(key, String(value));
      overlay.append(rect);
    }
    $('[data-source-meta]').textContent = seen.size
      ? `${seen.size} source regions linked to this reaction.`
      : 'No source region was supplied for this reaction.';
  }
  async function render() {
    const generation = ++renderGeneration;
    const reactions = records();
    $('[data-reaction-count]').textContent = `${reactions.length} records`;
    navigation.innerHTML = reactions.map((r, i) =>
      `<button type="button" data-record="${i}" aria-pressed="${i === selectedReaction}">${escape(r.instance_id || r.identifier || i + 1)}</button>`).join('');
    const reaction = reactions[selectedReaction];
    if (!reaction) {
      results.innerHTML = '<div class="empty-result"><strong>No chemical reactions found</strong><p>The analysis finished without extracting any reaction records. Try a reaction scheme or a chemistry table. You can still download the JSON result.</p></div>';
      $('[data-source-meta]').textContent = 'Analysis complete · no reaction regions to highlight.';
      return;
    }
    const steps = reaction.steps?.length ? reaction.steps : [reaction];
    let molecules = [];
    results.innerHTML = steps.map((step, stepIndex) => {
      const reactants = step.reactants ?? [];
      const products = step.products ?? [];
      const left = reactants.map((m) => moleculeCard(m, molecules.push(m) - 1)).join('<span class="molecule-plus">+</span>');
      const right = products.map((m) => moleculeCard(m, molecules.push(m) - 1)).join('<span class="molecule-plus">+</span>');
      const conditions = conditionItems(step.conditions ?? reaction.conditions ?? []);
      const metrics = step.metrics ?? reaction.metrics ?? [];
      return `<article class="visual-reaction"><header><span>REACTION ${selectedReaction + 1} OF ${reactions.length}</span><strong>${escape(reaction.instance_id || reaction.identifier || '')}${steps.length > 1 ? ` · Step ${stepIndex + 1}` : ''}</strong></header>
        <div class="reaction-scheme"><div class="scheme-side">${left || '<span>Not recorded</span>'}</div>
        <div class="reaction-arrow" aria-label="reacts to form">⟶</div>
        <div class="scheme-side">${right || '<span>No product recorded</span>'}</div></div>
        <div class="condition-section"><h3>Conditions</h3><div class="condition-chips">${conditions.map((c) =>
          `<span><b>${escape(c.role || 'Condition')}</b> ${escape(c.text)}</span>`).join('') || '<span>Not recorded</span>'}</div></div>
        <div class="metric-section">${metrics.map((m) => `<div><span>${escape(m.role || 'Outcome')}${m.of ? ` · ${escape(m.of)}` : ''}</span><strong>${escape(m.text ?? m.value ?? '')}</strong></div>`).join('')}</div>
        ${step.description ? `<p class="reaction-description">${escape(step.description)}</p>` : ''}</article>`;
    }).join('');
    highlight(molecules);
    try {
      const rdkit = await loadRDKit();
      if (generation !== renderGeneration) return;
      results.querySelectorAll('[data-molecule]').forEach((element) => {
        const molecule = molecules[Number(element.dataset.molecule)];
        const raw = rawOf(molecule);
        const separator = raw.indexOf('<sep>');
        const extension = separator < 0 ? '' : raw.slice(separator + 5);
        const body = molecule.smiles || (separator < 0 ? raw : raw.slice(0, separator));
        const canvas = element.querySelector('.structure-canvas');
        let mol;
        try {
          mol = body ? rdkit.get_mol(body) : null;
          if (!mol?.is_valid()) throw new Error('Unresolved structure');
          const svg = mol.get_svg(260, 180);
          // Display RDKit-generated SVG as an image, never inject source strings as SVG markup.
          const image = document.createElement('img');
          image.alt = `Structure of ${molecule.identifier || 'molecule'}`;
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
          canvas.replaceChildren(image);
          if (extension) {
            const note = document.createElement('small');
            note.className = 'extension-note';
            note.textContent = 'Backbone preview · extended labels/stereo are retained in E-SMILES below';
            canvas.after(note);
          }
        } catch { canvas.textContent = 'Structure unresolved — inspect E-SMILES'; }
        finally { mol?.delete(); }
      });
    } catch {
      results.querySelectorAll('.structure-canvas').forEach((canvas) => { canvas.textContent = 'Structure renderer unavailable — inspect E-SMILES'; });
    }
  }
  function setPrediction(value, name) {
    if (!value || typeof value !== 'object' || (!Array.isArray(value.selected_examples) && !Array.isArray(value.reactions)))
      throw new Error('The full JSON result is not available yet.');
    prediction = value;
    exportName = name;
    selectedReaction = 0;
    download.disabled = false;
    void render();
  }
  navigation.addEventListener('click', (event) => {
    const button = event.target.closest('[data-record]');
    if (!button) return;
    selectedReaction = Number(button.dataset.record);
    void render();
  });
  figure.addEventListener('load', () => { if (prediction) void render(); });
  download.addEventListener('click', () => {
    if (!prediction) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(prediction, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = exportName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  async function loadSample() {
    const version = ++operation;
    error(); clearResults();
    $('[data-workspace-state]').textContent = 'LOADING SAMPLE';
    const sample = await request(`${api}/sample`);
    if (version !== operation) return;
    showFigure(`${api}/sample/figure`);
    setPrediction(sample.prediction, 'rxnminer-recorded-sample.v2.json');
    $('[data-workspace-model]').textContent = `Recorded · ${sample.model?.id || 'archived model'}`;
    $('[data-workspace-state]').textContent = 'RECORDED WORKSPACE SAMPLE';
    $('[data-usage]').textContent = 'Recorded sample · no model calls or charges';
  }
  sampleButton.addEventListener('click', () => loadSample().catch((e) => error(e.message)));
  async function loadCatalog() {
    try {
      const result = await request(`${api}/models`);
      catalog = result.models ?? []; live = result.live === true;
      modelSelect.replaceChildren(...catalog.map((model, i) => new Option(
        `${model.label || model.id}${model.available === false ? ' · offline' : ''}`, String(i),
        model.default || model.id === result.defaultModel, model.default || model.id === result.defaultModel,
      )));
      updateRun();
      status(live ? 'Choose a model and upload a figure.' : 'Live service is offline. You can select a model and explore the recorded sample.');
    } catch (e) { status(e.message); updateRun(); }
  }
  async function loadSavedRun(jobId) {
    if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Invalid run link.');
    busy = true;
    updateRun();
    clearResults();
    showFigure(`${api}/jobs/${jobId}/artifacts/figure`);
    try {
      const deadline = Date.now() + 3600000;
      while (Date.now() < deadline) {
        const current = await request(`${api}/jobs/${jobId}`);
        showBilling(current);
        showProgress(current);
        $('[data-usage]').textContent = `Model calls ${current.usage?.modelCalls ?? 0} · Input tokens ${current.usage?.input ?? 0} · Output tokens ${current.usage?.output ?? 0} · Compactions ${current.compactions ?? 0}`;
        if (['review_ready', 'partial'].includes(current.status)) break;
        if (['failed', 'ready', 'cancelled', 'aborted', 'interrupted'].includes(current.status))
          throw new Error('This run did not produce a complete, reviewed result.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    const ready = await request(`${api}/jobs/${jobId}/result`);
    showBilling(ready);
    const source = ready.manifest?.artifacts?.find((item) => item.kind === 'input_figure');
    if (source) showFigure(new URL(source.url, api).href);
    setPrediction(ready.prediction, `rxnminer-${jobId}.v2.json`);
    $('[data-workspace-model]').textContent = ready.model;
    $('[data-workspace-state]').textContent = ready.terminalStatus === 'partial' ? 'PARTIAL RESULT' : records().length ? 'RESULTS READY' : 'NO REACTIONS FOUND';
    $('[data-usage]').textContent = `Model calls ${ready.usage?.modelCalls ?? 0} · Input tokens ${ready.usage?.input ?? 0} · Output tokens ${ready.usage?.output ?? 0}`;
    } finally {
      busy = false;
      updateRun();
    }
  }
  modelSelect.addEventListener('change', () => {
    updateRun();
    status(selectedModel()?.available && live
      ? `${selectedModel().label} selected.`
      : `${selectedModel()?.label || 'Model'} selected. Live extraction is currently offline.`);
  });
  function selectImage() {
    const file = input.files?.[0];
    if (!file) return;
    operation++;
    error(); clearResults();
    if (file.size > 5 * 1024 * 1024) { input.value = ''; error('Choose an image of 5 MiB or less.'); return; }
    if (figureObjectUrl) URL.revokeObjectURL(figureObjectUrl);
    figureObjectUrl = URL.createObjectURL(file);
    showFigure(figureObjectUrl);
    $('[data-file-name]').textContent = `${file.name} · ${(file.size / 1048576).toFixed(2)} MiB`;
    $('[data-workspace-state]').textContent = 'FIGURE READY';
  }
  input.addEventListener('change', selectImage);
  const drop = $('[data-upload-drop]');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); });
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    if (busy || !event.dataTransfer?.files.length) return;
    input.files = event.dataTransfer.files;
    selectImage();
  });
  $('[data-demo-form]').addEventListener('submit', async (event) => {
    event.preventDefault(); error();
    const model = selectedModel();
    if (!live || !model?.available) return error('This model is currently offline.');
    const file = input.files?.[0];
    if (!file) return error('Choose a figure first.');
    if (!$('[data-billing]').checked) return error('Confirm provider billing before starting.');
    busy = true; updateRun(); clearResults(); operation++;
    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Image could not be read.'));
        reader.readAsDataURL(file);
      });
      showFigure(imageData);
      $('[data-workspace-state]').textContent = 'STARTING EXTRACTION';
      const started = await request(`${api}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageData, fileName: file.name, provider: model.provider, modelId: model.id,
          modelApiKey: $('[data-model-key]').value, uniparserApiKey: $('[data-uniparser-key]').value,
          acceptProviderBilling: true,
        }),
      });
      $('[data-model-key]').value = ''; $('[data-uniparser-key]').value = '';
      const deadline = Date.now() + 3600000;
      while (Date.now() < deadline) {
        const current = await request(`${api}/jobs/${started.jobId}`);
        showBilling(current);
        showProgress(current);
        $('[data-usage]').textContent = `Model calls ${current.usage?.modelCalls ?? 0} · Input tokens ${current.usage?.input ?? 0} · Output tokens ${current.usage?.output ?? 0}`;
        if (['review_ready', 'partial'].includes(current.status)) {
          const ready = await request(`${api}/jobs/${started.jobId}/result`);
          showBilling(ready);
          // Never replace the full V2 result with a lossy manifest reconstruction.
          setPrediction(ready.prediction, `rxnminer-${started.jobId}.v2.json`);
          $('[data-workspace-model]').textContent = model.label;
          $('[data-workspace-state]').textContent = current.status === 'partial' ? 'PARTIAL RESULT' : records().length ? 'RESULTS READY' : 'NO REACTIONS FOUND';
          status(records().length ? 'Inspect each reaction and download the full JSON result.' : 'Analysis complete. No chemical reactions were extracted from this image.');
          const link = new URL(location.href);
          link.searchParams.set('job', started.jobId);
          history.replaceState(null, '', link);
          return;
        }
        if (['failed', 'cancelled', 'interrupted', 'aborted'].includes(current.status)) throw new Error('The extraction stopped without a complete result.');
        if (current.status === 'ready') throw new Error('The model stopped before completing validation and rendering. This run has no final result; please retry.');
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      throw new Error('Polling timed out. The job may still be running.');
    } catch (e) { error(e.message); $('[data-workspace-state]').textContent = 'RESULT UNAVAILABLE'; }
    finally {
      $('[data-model-key]').value = ''; $('[data-uniparser-key]').value = '';
      busy = false; updateRun();
    }
  });
  void loadCatalog();
  const savedJob = new URL(location.href).searchParams.get('job');
  void (savedJob ? loadSavedRun(savedJob) : loadSample()).catch((e) => error(e.message));
}
