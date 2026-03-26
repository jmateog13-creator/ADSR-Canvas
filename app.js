/**
 * ADSR-Canvas — core audio engine & UI logic
 * Modes: home | arena | sandbox
 */

// ─── Global Audio State ────────────────────────────────────────────────────────
let synth, sampler, currentInstrument;
let analyzer, waveform;
let filter, reverb, delay;
const masterVol = new Tone.Volume(-8).toDestination();
const adsr = { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.4 };

// current mode: 'arena' | 'sandbox'
let currentMode = null;
let arenaKnobsReady = false;
let sandboxKnobsReady = false;
let adsrArena, adsrSandbox;

// ─── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), duration);
}

// ─── Screen Navigation ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.body.className = 'mode-' + name;
  currentMode = name;
}

async function enterArena() {
  showScreen('arena');
  await init('arena');
  loadArenaProgress();
  loadExercise(currentExerciseIndex);
  drawVisualizers('fftCanvas', 'oscCanvas');
  drawFilterCurve('filterCurveCanvas');
  if (adsrArena) adsrArena.draw();
}

async function enterSandbox() {
  showScreen('sandbox');
  await init('sandbox');
  drawVisualizers('fftCanvas-sb', 'oscCanvas-sb');
  drawFilterCurve('filterCurveCanvas-sb');
  if (adsrSandbox) adsrSandbox.draw();
}

function goHome() {
  if (Tone.Transport.state === 'started') {
    Tone.Transport.stop();
    seqStep = 0;
    document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('ph'));
    const btn = document.getElementById('seq-play');
    if (btn) { btn.textContent = '▶ REPRODUIR'; btn.classList.remove('playing'); }
    const tag = document.querySelector('.playing-state');
    if (tag) tag.style.display = 'none';
  }
  showScreen('home');
  updateArenaProgressText();
}

// ─── Audio Core Setup ──────────────────────────────────────────────────────
async function ensureAudioSetup() {
  if (Tone.context.state === 'running' && filter) return;
  if (Tone.context.state !== 'running') await Tone.start();

  if (!filter) {
    filter = new Tone.Filter(2500, 'lowpass');
    reverb = new Tone.Reverb({ decay: 1.5, wet: 0.3 });
    delay  = new Tone.FeedbackDelay({ delayTime: '4n', feedback: 0.4, wet: 0.2 });

    filter.connect(reverb);
    reverb.connect(delay);
    delay.connect(masterVol);

    analyzer = new Tone.FFT(32);
    waveform  = new Tone.Waveform(1024);
    masterVol.connect(analyzer);
    masterVol.connect(waveform);
  }
}

// ─── Audio Initialization (per mode) ──────────────────────────────────────────
async function init(mode) {
  await ensureAudioSetup();
  const synthType = mode === 'sandbox' ? (document.getElementById('synth-type-sb')?.value || 'synth') : (document.getElementById('synth-type')?.value || 'synth');
  updateInstrument(synthType);
  if ((mode === 'arena' && !arenaKnobsReady) || (mode === 'sandbox' && !sandboxKnobsReady)) {
    initKnobs(mode);
  }
}

// ─── Instrument ────────────────────────────────────────────────────────────────
const updateInstrument = (type) => {
  if (synth)   synth.dispose();
  if (sampler) sampler.dispose();

  const suffix = currentMode === 'sandbox' ? '-sb' : '';
  const oscSel = document.getElementById('osc-type' + suffix);
  const oscVal = oscSel ? oscSel.value : 'triangle';
  const common = { envelope: { ...adsr }, oscillator: { type: oscVal } };

  if (type === 'sampler') {
    currentInstrument = sampler;
  } else {
    const synths = { synth: Tone.Synth, amsynth: Tone.AMSynth, fmsynth: Tone.FMSynth, monosynth: Tone.MonoSynth };
    synth = new synths[type](common).connect(filter);
    currentInstrument = synth;
  }
};

// ─── Knob Class ────────────────────────────────────────────────────────────────
class Knob {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.min = parseFloat(el.dataset.min);
    this.max = parseFloat(el.dataset.max);
    this.val = parseFloat(el.dataset.val);
    this.step = parseFloat(el.dataset.step || 1);
    this.isDragging = false;
    this.startY = 0;
    this.startVal = 0;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el.appendChild(this.canvas);
    this.resize();
    this.initEvents();
    this.draw();
  }

  resize() {
    this.size = this.el.offsetWidth || 60;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width  = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.ctx.scale(dpr, dpr);
  }

  initEvents() {
    // Mouse
    this.canvas.addEventListener('mousedown', e => {
      this.isDragging = true;
      this.startY   = e.clientY;
      this.startVal = this.val;
      document.body.style.cursor = 'ns-resize';
    });
    window.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      const delta = (this.startY - e.clientY) * 0.01;
      this.update(this.startVal + delta * (this.max - this.min));
    });
    window.addEventListener('mouseup', () => {
      if (this.isDragging) { this.isDragging = false; document.body.style.cursor = 'default'; }
    });
    // Touch
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this.isDragging = true;
      this.startY   = e.touches[0].clientY;
      this.startVal = this.val;
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      if (!this.isDragging) return;
      e.preventDefault();
      const delta = (this.startY - e.touches[0].clientY) * 0.015;
      this.update(this.startVal + delta * (this.max - this.min));
    }, { passive: false });
    window.addEventListener('touchend', () => { this.isDragging = false; });
    // Resize
    window.addEventListener('resize', () => { this.resize(); this.draw(); });
  }

  update(newVal) {
    this.val = Math.min(this.max, Math.max(this.min, newVal));
    if (this.step < 1) {
      const p = 1 / this.step;
      this.val = Math.round(this.val * p) / p;
    } else {
      this.val = Math.round(this.val / this.step) * this.step;
    }
    this.draw();
    if (this.onChange) this.onChange(this.val);
    const parent = this.el.closest('[role="slider"]');
    if (parent) parent.setAttribute('aria-valuenow', this.val);
  }

  draw() {
    const ctx = this.ctx, s = this.size, c = s / 2, r = s * 0.4;
    const isMag = this.el.id.includes('rev') || this.el.id.includes('del');
    const accent = isMag ? '#FF00FF' : '#00FFCC';
    ctx.clearRect(0, 0, s, s);
    // Track
    ctx.beginPath(); ctx.arc(c, c, r, 0.75*Math.PI, 2.25*Math.PI);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    // Value arc
    const ratio = (this.val - this.min) / (this.max - this.min);
    const endAngle = 0.75*Math.PI + ratio * 1.5*Math.PI;
    ctx.beginPath(); ctx.arc(c, c, r, 0.75*Math.PI, endAngle);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    // Body
    ctx.beginPath(); ctx.arc(c, c, r - 6, 0, 2*Math.PI);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
    // Indicator
    ctx.save(); ctx.translate(c, c); ctx.rotate(endAngle);
    ctx.beginPath(); ctx.moveTo(r-12, 0); ctx.lineTo(r-6, 0);
    ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
}

// ─── Knob Initialization ───────────────────────────────────────────────────────
function initKnobs(mode) {
  const suffix = mode === 'arena' ? '' : '-sb';
  const cutoffEl = document.getElementById('knob-cutoff' + suffix);
  if (!cutoffEl || cutoffEl.querySelector('canvas')) {
    if (mode === 'arena') arenaKnobsReady = true;
    else sandboxKnobsReady = true;
    return; // already initialized
  }

  const el = id => document.getElementById(id + suffix);
  const txt = (id, val) => { const e = el(id); if (e) e.textContent = val; };

  new Knob(el('knob-cutoff'), val => {
    if (filter) filter.frequency.value = val;
    txt('val-cutoff', val > 1000 ? (val/1000).toFixed(1)+'k' : Math.round(val));
    drawFilterCurve('filterCurveCanvas' + suffix);
  });

  new Knob(el('knob-res'), val => {
    if (filter) filter.Q.value = val;
    txt('val-res', val.toFixed(1));
    drawFilterCurve('filterCurveCanvas' + suffix);
  });

  new Knob(el('knob-rev-decay'), val => {
    if (reverb) reverb.decay = val;
    txt('val-rev-decay', val.toFixed(1)+'s');
    if (mode === 'sandbox') completeChallenge('use_fx');
  });

  new Knob(el('knob-rev-mix'), val => {
    if (reverb) reverb.wet.value = val;
    txt('val-rev-mix', Math.round(val*100)+'%');
    if (mode === 'sandbox') completeChallenge('use_fx');
  });

  new Knob(el('knob-del-time'), val => {
    if (delay) delay.delayTime.value = val;
    txt('val-del-time', Math.round(val*1000)+'ms');
    if (mode === 'sandbox') completeChallenge('use_fx');
  });

  new Knob(el('knob-del-fback'), val => {
    if (delay) delay.feedback.value = val;
    txt('val-del-fback', Math.round(val*100)+'%');
    if (mode === 'sandbox') completeChallenge('use_fx');
  });

  new Knob(el('knob-del-mix'), val => {
    if (delay) delay.wet.value = val;
    txt('val-del-mix', Math.round(val*100)+'%');
    if (mode === 'sandbox') completeChallenge('use_fx');
  });

  if (mode === 'arena') arenaKnobsReady = true;
  else sandboxKnobsReady = true;
}

// ─── Filter Curve ──────────────────────────────────────────────────────────────
function drawFilterCurve(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width  = canvas.parentElement.offsetWidth;
  const h = canvas.height = canvas.parentElement.offsetHeight;
  ctx.clearRect(0, 0, w, h);
  if (!filter) return;
  const freq = filter.frequency.value, Q = filter.Q.value, type = filter.type;
  ctx.beginPath(); ctx.strokeStyle = '#00FFCC'; ctx.lineWidth = 2;
  ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(0,255,204,0.5)';
  for (let x = 0; x < w; x++) {
    const f = Math.pow(10, (x/w) * Math.log10(20000/20)) * 20;
    let gain = 1;
    if (type === 'lowpass')       gain = 1 / Math.sqrt(1 + Math.pow(f/freq, 4));
    else if (type === 'highpass') gain = 1 / Math.sqrt(1 + Math.pow(freq/f, 4));
    else if (type === 'bandpass') { const bw=freq/Q; gain = Math.exp(-Math.pow(f-freq,2)/(2*Math.pow(bw,2))); }
    else if (type === 'notch')    { const bw=freq/Q; gain = 1-Math.exp(-Math.pow(f-freq,2)/(2*Math.pow(bw,2))); }
    const y = h - (gain * h * 0.8) - 10;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.shadowBlur = 0;
}

// ─── Visualizers ───────────────────────────────────────────────────────────────
// Each (fftId+oscId) pair gets its own independent animation loop.
// Arena uses 'fftCanvas'+'oscCanvas', sandbox uses 'fftCanvas-sb'+'oscCanvas-sb'.
// Both can run simultaneously since each mode has its own canvas elements.
const activeVizLoops = new Set();

function drawVisualizers(fftId, oscId) {
  const key = fftId + '|' + oscId;
  if (activeVizLoops.has(key)) return;
  activeVizLoops.add(key);

  const fftC = document.getElementById(fftId);
  const oscC = document.getElementById(oscId);
  if (!fftC || !oscC) { activeVizLoops.delete(key); return; }

  const fftCtx = fftC.getContext('2d');
  const oscCtx = oscC.getContext('2d');

  const render = () => {
    if (!activeVizLoops.has(key)) return;
    requestAnimationFrame(render);

    if (fftC.width !== fftC.parentElement.offsetWidth) {
      fftC.width = fftC.parentElement.offsetWidth; fftC.height = 180;
      oscC.width = oscC.parentElement.offsetWidth; oscC.height = 180;
    }
    if (!analyzer || !waveform) return;

    // FFT
    const data = analyzer.getValue();
    fftCtx.fillStyle = '#0e0e0e';
    fftCtx.fillRect(0, 0, fftC.width, fftC.height);
    const bw = fftC.width / data.length;
    data.forEach((v, i) => {
      const h = Math.max(2, (v + 100) * 1.8);
      const g = fftCtx.createLinearGradient(0, fftC.height-h, 0, fftC.height);
      g.addColorStop(0, '#00FFCC'); g.addColorStop(1, '#FF00FF');
      fftCtx.fillStyle = g;
      fftCtx.fillRect(i*bw, fftC.height-h, bw-2, h);
    });

    // OSC
    const wave = waveform.getValue();
    oscCtx.fillStyle = '#0e0e0e';
    oscCtx.fillRect(0, 0, oscC.width, oscC.height);
    oscCtx.beginPath(); oscCtx.strokeStyle = '#FF00FF'; oscCtx.lineWidth = 2;
    oscCtx.shadowBlur = 10; oscCtx.shadowColor = 'rgba(255,0,255,0.5)';
    const sl = oscC.width / wave.length;
    wave.forEach((v, i) => {
      const x = i*sl, y = (v+1)/2 * oscC.height;
      i === 0 ? oscCtx.moveTo(x, y) : oscCtx.lineTo(x, y);
    });
    oscCtx.stroke(); oscCtx.shadowBlur = 0;
  };
  render();
}

// ─── ADSR Canvas Editor ────────────────────────────────────────────────────────
function setupADSR(canvasId, valIds, onDrag) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let nodes = [
    { id:'A', x:0.1, y:0.1 },
    { id:'D', x:0.3, y:0.4 },
    { id:'S', x:0.7, y:0.4 },
    { id:'R', x:0.9, y:1.0 }
  ];
  let activeNode = null;

  const draw = () => {
    if (!canvas.parentElement || canvas.parentElement.offsetWidth === 0) return;
    const w = canvas.width  = canvas.parentElement.offsetWidth;
    const h = canvas.height = canvas.parentElement.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo(i*w/10, 0); ctx.lineTo(i*w/10, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*h/10); ctx.lineTo(w, i*h/10); ctx.stroke();
    }

    // Curve
    ctx.beginPath();
    ctx.moveTo(0, h);
    nodes.forEach(n => ctx.lineTo(n.x*w, n.y*h));
    ctx.strokeStyle = '#00FFCC'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();

    // Fill
    ctx.lineTo(nodes[3].x*w, h); ctx.lineTo(0, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,255,204,0.2)');
    grad.addColorStop(1, 'rgba(0,255,204,0)');
    ctx.fillStyle = grad; ctx.fill();

    // Nodes
    nodes.forEach(n => {
      ctx.beginPath(); ctx.arc(n.x*w, n.y*h, 8, 0, Math.PI*2);
      ctx.fillStyle = '#00FFCC'; ctx.shadowBlur = 10; ctx.shadowColor = '#00FFCC'; ctx.fill();
      ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = '10px JetBrains Mono';
      ctx.fillText(n.id, n.x*w - 3, n.y*h - 14);
    });

    updateADSRParams(nodes, valIds);
    if (onDrag) onDrag();
  };

  const constrain = (id, mx, my) => {
    const i = nodes.findIndex(n => n.id === id);
    if (id === 'A') mx = Math.min(mx, nodes[1].x - 0.01);
    if (id === 'D') { mx = Math.max(mx, nodes[0].x+0.01); mx = Math.min(mx, nodes[2].x-0.01); }
    if (id === 'S') { mx = Math.max(mx, nodes[1].x+0.01); mx = Math.min(mx, nodes[3].x-0.01); my = nodes[1].y; }
    if (id === 'R') mx = Math.max(mx, nodes[2].x+0.01);
    nodes[i].x = mx;
    if (id !== 'S' && id !== 'R') nodes[i].y = my;
    if (id === 'D' || id === 'S') nodes[1].y = nodes[2].y = my;
    draw();
  };

  const rel = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return {
      mx: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      my: Math.max(0, Math.min(1, (clientY - r.top)  / r.height))
    };
  };

  // Mouse
  canvas.addEventListener('mousedown', e => {
    const { mx, my } = rel(e.clientX, e.clientY);
    activeNode = nodes.find(n => Math.hypot(n.x-mx, n.y-my) < 0.06) || null;
  });
  window.addEventListener('mousemove', e => {
    if (!activeNode) return;
    const { mx, my } = rel(e.clientX, e.clientY);
    constrain(activeNode.id, mx, my);
  });
  window.addEventListener('mouseup', () => activeNode = null);

  // Touch
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const { mx, my } = rel(e.touches[0].clientX, e.touches[0].clientY);
    activeNode = nodes.find(n => Math.hypot(n.x-mx, n.y-my) < 0.09) || null;
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (!activeNode) return;
    e.preventDefault();
    const { mx, my } = rel(e.touches[0].clientX, e.touches[0].clientY);
    constrain(activeNode.id, mx, my);
  }, { passive: false });
  window.addEventListener('touchend', () => activeNode = null);

  window.addEventListener('resize', draw);
  draw();
  return { draw };
}

function updateADSRParams(nodes, valIds) {
  adsr.attack  = nodes[0].x * 2;
  adsr.decay   = (nodes[1].x - nodes[0].x) * 2;
  adsr.sustain = 1 - nodes[1].y;
  adsr.release = (nodes[3].x - nodes[2].x) * 2;

  if (valIds) {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set(valIds.attack,  adsr.attack.toFixed(2)  + 's');
    set(valIds.decay,   adsr.decay.toFixed(2)   + 's');
    set(valIds.sustain, adsr.sustain.toFixed(2));
    set(valIds.release, adsr.release.toFixed(2) + 's');
  }
  if (currentInstrument && currentInstrument.envelope) currentInstrument.envelope.set(adsr);
}

// ─── Sequencer ─────────────────────────────────────────────────────────────────
const notes = ['C4','B3','Bb3','A3','Ab3','G3','Gb3','F3','E3','Eb3','D3','Db3','C3'];
let grid = Array(notes.length).fill().map(() => Array(16).fill(false));
let seqStep = 0;

const setupSequencer = () => {
  const labelCont = document.getElementById('note-labels');
  const gridCont  = document.getElementById('seq-grid');
  if (!labelCont || !gridCont) return;

  notes.forEach((note, i) => {
    const lb = document.createElement('div');
    lb.className = `note-label ${note.includes('b') ? 'sharp' : ''}`;
    lb.textContent = note;
    labelCont.appendChild(lb);

    const row = document.createElement('div');
    row.className = 'grid-row';
    for (let j = 0; j < 16; j++) {
      const cell = document.createElement('div');
      cell.className = `grid-cell ${j%4===0 ? 'beat' : ''}`;
      cell.setAttribute('aria-label', `Nota ${note}, Paso ${j+1}`);
      cell.setAttribute('aria-pressed', 'false');
      cell.onclick = () => {
        grid[i][j] = !grid[i][j];
        cell.classList.toggle('on', grid[i][j]);
        cell.setAttribute('aria-pressed', String(grid[i][j]));
      };
      row.appendChild(cell);
    }
    gridCont.appendChild(row);
  });

  Tone.Transport.scheduleRepeat(time => {
    grid.forEach((row, i) => {
      if (row[seqStep] && currentInstrument) {
        currentInstrument.triggerAttackRelease(notes[i], '16n', time);
        createRipple(i, seqStep);
      }
    });
    document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('ph'));
    document.querySelectorAll('.grid-row').forEach(r => {
      if (r.children[seqStep]) r.children[seqStep].classList.add('ph');
    });
    seqStep = (seqStep + 1) % 16;
  }, '16n');
};

const createRipple = (ri, ci) => {
  const rows = document.querySelectorAll('.grid-row');
  if (!rows[ri]) return;
  const cell = rows[ri].children[ci];
  const r = document.createElement('div');
  r.className = 'ripple'; cell.appendChild(r);
  setTimeout(() => r.remove(), 500);
};

// ─── Save / Load / Export ──────────────────────────────────────────────────────
function saveGrid() {
  const bpm = document.getElementById('bpm-slider')?.value || 120;
  localStorage.setItem('adsr-canvas-grid', JSON.stringify({ grid, bpm }));
  showToast('Patró desat ✓');
}

function loadGrid() {
  try {
    const raw = localStorage.getItem('adsr-canvas-grid');
    if (!raw) { showToast('No hi ha cap patró desat'); return; }
    const { grid: saved, bpm } = JSON.parse(raw);
    grid = saved;
    const bpmSlider = document.getElementById('bpm-slider');
    if (bpmSlider && bpm) {
      bpmSlider.value = bpm;
      Tone.Transport.bpm.value = bpm;
      document.getElementById('bpm-val').textContent = bpm;
    }
    document.querySelectorAll('.grid-row').forEach((row, i) => {
      Array.from(row.children).forEach((cell, j) => {
        const on = !!(grid[i]?.[j]);
        cell.classList.toggle('on', on);
        cell.setAttribute('aria-pressed', String(on));
      });
    });
    showToast('Patró carregat ✓');
  } catch(e) { showToast('Error al carregar el patró'); }
}

function exportGrid() {
  const bpm = document.getElementById('bpm-slider')?.value || 120;
  const blob = new Blob([JSON.stringify({ grid, bpm, notes }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'adsr-patron.json'; a.click();
  URL.revokeObjectURL(url);
}

// ─── Challenges (Sandbox) ──────────────────────────────────────────────────────
const CHALLENGE_TITLES = {
  first_note:'Primera nota', edit_adsr:'Esculpeix el so',
  use_fx:'Afegeix efectes', play_seq:'Crea un ritme', load_preset:'Explora els presets'
};
let completedChallenges = new Set();

function loadChallenges() {
  try { const s = localStorage.getItem('adsr-challenges'); if (s) JSON.parse(s).forEach(id => completedChallenges.add(id)); } catch(e) {}
  completedChallenges.forEach(id => markChallengeDone(id, false));
  updateChallengeProgress();
}

function completeChallenge(id) {
  if (completedChallenges.has(id)) return;
  completedChallenges.add(id);
  localStorage.setItem('adsr-challenges', JSON.stringify([...completedChallenges]));
  markChallengeDone(id, true);
  updateChallengeProgress();
  if (completedChallenges.size === 5) setTimeout(() => showToast('Tots els reptes completats! Ets un productor! 🏆', 4000), 800);
}

function markChallengeDone(id, notify) {
  const item = document.getElementById('ch-' + id);
  if (!item) return;
  item.classList.add('done');
  item.querySelector('.ch-check').textContent = '✓';
  if (notify) showToast('Repte completat: ' + CHALLENGE_TITLES[id] + '! 🎉');
}

function updateChallengeProgress() {
  const el = document.getElementById('ch-progress');
  if (el) el.textContent = completedChallenges.size + ' / 5';
}

// ─── Arena Exercises ───────────────────────────────────────────────────────────
const EXERCISES = [
  {
    id: 'percussive', emoji: '🥁', title: 'El Cop Sec',
    desc: 'Crea un so percussiu com un cop de tambor. Ha de sonar instantàniament i desaparèixer molt ràpid, sense cua.',
    tips: ['Posa l\'Atac (A) molt curt, gairebé a 0', 'Baixa el Sostingut (S) fins a 0 o molt baix', 'Escurça molt la Lliberació (R)', 'Prova l\'ona Quadrada o Triangular'],
    validate: () => adsr.attack < 0.15 && adsr.sustain < 0.3 && adsr.release < 0.4,
    feedback: () => {
      if (adsr.attack  >= 0.15) return 'L\'Atac és molt llarg! Escurça\'l perquè el so entri de cop.';
      if (adsr.sustain >= 0.3)  return 'El Sostingut està molt alt! Baixa\'l perquè el so no es mantingui.';
      if (adsr.release >= 0.4)  return 'La Lliberació és molt llarga! Escurça\'la perquè el so talli ràpid.';
      return null;
    }
  },
  {
    id: 'long', emoji: '🎻', title: 'La Nota Llarga',
    desc: 'Crea un so que trigui a aparèixer i que no es talli bruscament. Com l\'arc d\'un violí entrant suaument.',
    tips: ['Puja l\'Atac (A) per sobre de 0.8 segons', 'Manté el Sostingut (S) alt (> 0.5)', 'Puja la Lliberació (R) per sobre de 0.8 segons', 'Prova l\'ona Senoidal'],
    validate: () => adsr.attack > 0.7 && adsr.release > 0.7 && adsr.sustain > 0.4,
    feedback: () => {
      if (adsr.attack  <= 0.7) return 'L\'Atac és massa curt! Puja\'l perquè entri suaument.';
      if (adsr.sustain <= 0.4) return 'El Sostingut és molt baix! Puja\'l perquè el so es mantingui.';
      if (adsr.release <= 0.7) return 'La Lliberació és molt curta! Puja-la perquè s\'esvaeixi a poc a poc.';
      return null;
    }
  },
  {
    id: 'pluck', emoji: '🪕', title: 'El Pluck',
    desc: 'Simula el so d\'una corda pulsada: puja fort de cop i baixa progressivament, com una guitarra.',
    tips: ['Atac (A) molt curt (gairebé 0)', 'Decaiment (D) llarg (> 0.3s)', 'Sostingut (S) baix (< 0.4)', 'Lliberació (R) mitjana'],
    validate: () => adsr.attack < 0.12 && adsr.decay > 0.25 && adsr.sustain < 0.45,
    feedback: () => {
      if (adsr.attack  >= 0.12) return 'L\'Atac ha de ser molt curt per a l\'efecte "pluck"!';
      if (adsr.decay   <= 0.25) return 'El Decaiment és molt curt! Alarga el Decay perquè baixi gradualment.';
      if (adsr.sustain >= 0.45) return 'El Sostingut està molt alt! Baixa\'l perquè no es mantingui.';
      return null;
    }
  },
  {
    id: 'bass', emoji: '🌑', title: 'El Baix Fosc',
    desc: 'Crea un so de baix profund i fosc. Només han de sonar les freqüències greus.',
    tips: ['Posa el filtre en "Pas Baix (Lowpass)"', 'Baixa el Tall (Cutoff) per sota de 500 Hz', 'Usa l\'ona Serra (Sawtooth)', 'Escolta com canvia el color del so'],
    validate: () => filter && filter.type === 'lowpass' && filter.frequency.value < 500,
    feedback: () => {
      if (!filter || filter.type !== 'lowpass')         return 'Posa el filtre en "Pas Baix (Lowpass)" per eliminar els aguts!';
      if (filter && filter.frequency.value >= 500) return 'Baixa més el Tall (Cutoff)! Ha d\'estar per sota de 500 Hz.';
      return null;
    }
  },
  {
    id: 'echo', emoji: '🚀', title: 'L\'Eco Espacial',
    desc: 'Crea un so que sembli estar a l\'espai, ple de profunditat i ecos repetitius.',
    tips: ['Puja el Feedback del Delay per sobre del 50%', 'Puja la Mescla (Mix) del Delay', 'Afegeix força Reverb (Mix > 35%)', 'Prova un Reverb Decay llarg (> 3s)'],
    validate: () => delay && reverb && delay.feedback.value > 0.5 && reverb.wet.value > 0.35,
    feedback: () => {
      if (!delay  || delay.feedback.value <= 0.5)  return 'Puja el Feedback del Delay per sobre del 50%!';
      if (!reverb || reverb.wet.value  <= 0.35) return 'Puja la Mescla (Mix) del Reverb per afegir profunditat!';
      return null;
    }
  },
  {
    id: 'pad', emoji: '🌊', title: 'El Pad Ambiental',
    desc: 'Els pads són sons suaus i flotants de fons en música ambient. Han d\'entrar i sortir molt suaument.',
    tips: ['Puja l\'Atac (A) per sobre de 0.4s', 'Puja la Lliberació (R) per sobre d\'1 segon', 'Afegeix força Reverb (Mix > 35%)', 'Prova l\'ona Senoidal o Triangular'],
    validate: () => reverb && adsr.attack > 0.4 && adsr.release > 0.9 && reverb.wet.value > 0.35,
    feedback: () => {
      if (adsr.attack  <= 0.4)              return 'L\'Atac és molt curt! Puja\'l perquè entri suaument.';
      if (adsr.release <= 0.9)              return 'L\'Lliberació és molt curta! Els pads necessiten un release llarg.';
      if (!reverb || reverb.wet.value <= 0.35) return 'Afegeix més Reverb! És essencial per al so de pad.';
      return null;
    }
  },
  {
    id: 'bright', emoji: '⚡', title: 'El Lead Brillant',
    desc: 'Crea un so agut i brillant per a un "lead" de sintetitzador. Usa l\'ona més rica en harmònics.',
    tips: ['Usa l\'ona "Serra (Sawtooth)" — és la més brillant', 'Puja el Tall (Cutoff) del filtre per sobre de 4000 Hz', 'Atac curt i Lliberació mitjana', 'Prova FM Synth per a més riquesa'],
    validate: () => {
      const osc = document.getElementById('osc-type')?.value;
      return osc === 'sawtooth' && filter && filter.frequency.value > 4000;
    },
    feedback: () => {
      const osc = document.getElementById('osc-type')?.value;
      if (osc !== 'sawtooth')                        return 'Selecciona l\'ona "Serra (Sawtooth)" — és la més brillant!';
      if (!filter || filter.frequency.value <= 4000) return 'Puja el Tall (Cutoff) del filtre per sobre de 4000 Hz!';
      return null;
    }
  }
];

let currentExerciseIndex = 0;
let arenaCompleted = new Set();

function loadArenaProgress() {
  try { const s = localStorage.getItem('adsr-arena'); if (s) JSON.parse(s).forEach(id => arenaCompleted.add(id)); } catch(e) {}
  updateArenaProgressText();
}

function saveArenaProgress() {
  localStorage.setItem('adsr-arena', JSON.stringify([...arenaCompleted]));
}

function updateArenaProgressText() {
  const el = document.getElementById('arena-progress-text');
  if (el) el.textContent = arenaCompleted.size + ' / ' + EXERCISES.length + ' completats';
}

function loadExercise(index) {
  currentExerciseIndex = index;
  const ex = EXERCISES[index];

  document.getElementById('ex-emoji').textContent = ex.emoji;
  document.getElementById('ex-title').textContent = ex.title;
  document.getElementById('ex-desc').textContent  = ex.desc;
  document.getElementById('exercise-counter').textContent = `Exercici ${index+1} / ${EXERCISES.length}`;

  const tipsList = document.getElementById('ex-tips-list');
  tipsList.innerHTML = '';
  ex.tips.forEach(tip => {
    const li = document.createElement('li'); li.textContent = tip; tipsList.appendChild(li);
  });

  const fb = document.getElementById('ex-feedback');
  fb.textContent = ''; fb.className = 'exercise-feedback';
  if (arenaCompleted.has(ex.id)) {
    fb.textContent = '✓ Exercici ja completat! Pots seguir explorant.';
    fb.className = 'exercise-feedback success';
  }

  document.getElementById('ex-prev').disabled = (index === 0);
  document.getElementById('ex-next').textContent = index === EXERCISES.length-1 ? '🏁 Acabar' : 'Següent →';

  renderExerciseDots();
}

function renderExerciseDots() {
  const el = document.getElementById('ex-dots');
  if (!el) return;
  el.innerHTML = '';
  EXERCISES.forEach((ex, i) => {
    const dot = document.createElement('span');
    dot.className = 'ex-dot' +
      (i === currentExerciseIndex ? ' active' : '') +
      (arenaCompleted.has(ex.id) ? ' done' : '');
    el.appendChild(dot);
  });
}

function checkExercise() {
  const ex = EXERCISES[currentExerciseIndex];
  const errMsg = ex.feedback();
  const fb = document.getElementById('ex-feedback');

  if (!errMsg) {
    arenaCompleted.add(ex.id);
    saveArenaProgress();
    updateArenaProgressText();
    fb.textContent = '🎉 Perfecte! Has aconseguit el so. Bona feina!';
    fb.className = 'exercise-feedback success';
    renderExerciseDots();
    showToast('Exercici completat: ' + ex.title + '! 🎉');
    if (arenaCompleted.size === EXERCISES.length) {
      setTimeout(() => showToast('Tots els exercicis completats! Ets un sintetitzador! 🏆', 4000), 1000);
    }
  } else {
    fb.textContent = '💡 ' + errMsg;
    fb.className = 'exercise-feedback hint';
  }
}

// ─── Tutorial ──────────────────────────────────────────────────────────────────
let tutStep = 0;
const TUT_TOTAL = 5;

function openTutorial() {
  tutStep = 0; renderTutStep();
  document.getElementById('tutorial-modal').style.display = 'flex';
}
function closeTutorial() { document.getElementById('tutorial-modal').style.display = 'none'; }
function renderTutStep() {
  document.querySelectorAll('.tut-slide').forEach((s, i) => s.classList.toggle('active', i === tutStep));
  document.getElementById('tut-prev').style.visibility = tutStep === 0 ? 'hidden' : 'visible';
  document.getElementById('tut-next').textContent = tutStep === TUT_TOTAL-1 ? 'Entès!' : 'Següent →';
  const dc = document.getElementById('tut-dots');
  if (dc) {
    dc.innerHTML = '';
    for (let i = 0; i < TUT_TOTAL; i++) {
      const d = document.createElement('span');
      d.className = 'tut-dot' + (i === tutStep ? ' active' : '');
      dc.appendChild(d);
    }
  }
}

// ─── Info Modal ────────────────────────────────────────────────────────────────
function openInfoModal(title, body) {
  document.getElementById('info-modal-title').textContent = title;
  document.getElementById('info-modal-body').textContent  = body;
  document.getElementById('info-modal').style.display = 'flex';
}

// ─── DOMContentLoaded ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Setup both ADSR canvases (independent — same shared adsr state)
  adsrArena = setupADSR('adsrCanvas',
    { attack:'val-attack', decay:'val-decay', sustain:'val-sustain', release:'val-release' }
  );
  adsrSandbox = setupADSR('adsrCanvas-sb',
    { attack:'val-attack-sb', decay:'val-decay-sb', sustain:'val-sustain-sb', release:'val-release-sb' },
    () => completeChallenge('edit_adsr')
  );

  setupSequencer();
  loadChallenges();
  loadArenaProgress();

  // ── Splash ──
  document.getElementById('start-app').onclick = () => {
    document.getElementById('splash-overlay').classList.add('hidden');
    setTimeout(() => { document.getElementById('splash-overlay').style.display = 'none'; showScreen('home'); }, 500);
  };
  document.getElementById('splash-tutorial-btn').onclick = () => {
    document.getElementById('splash-overlay').classList.add('hidden');
    setTimeout(() => { document.getElementById('splash-overlay').style.display = 'none'; showScreen('home'); openTutorial(); }, 500);
  };

  // ── Home ──
  document.getElementById('btn-arena').onclick   = enterArena;
  document.getElementById('btn-sandbox').onclick = enterSandbox;
  document.getElementById('btn-arena').addEventListener('keydown',   e => { if (e.key==='Enter'||e.key===' ') enterArena(); });
  document.getElementById('btn-sandbox').addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') enterSandbox(); });
  document.getElementById('home-help-btn').onclick = openTutorial;

  // ── Arena ──
  document.getElementById('arena-back').onclick  = goHome;
  document.getElementById('arena-help-btn').onclick = openTutorial;
  document.getElementById('ex-prev').onclick     = () => { if (currentExerciseIndex > 0) loadExercise(currentExerciseIndex-1); };
  document.getElementById('ex-next').onclick     = () => {
    if (currentExerciseIndex < EXERCISES.length-1) loadExercise(currentExerciseIndex+1);
    else goHome();
  };
  document.getElementById('ex-test').onclick     = async () => {
    await ensureAudioSetup();
    if (currentInstrument) currentInstrument.triggerAttackRelease('C4', '2n');
  };
  document.getElementById('ex-check').onclick    = checkExercise;

  // Arena selects
  document.getElementById('osc-type').onchange   = e => { if (synth) synth.oscillator.type = e.target.value; };
  document.getElementById('synth-type').onchange = e => updateInstrument(e.target.value);
  document.getElementById('filter-type').onchange = e => { if (filter) { filter.type = e.target.value; drawFilterCurve('filterCurveCanvas'); } };

  // ── Sandbox ──
  document.getElementById('sandbox-home-btn').onclick = goHome;
  document.getElementById('help-btn').onclick = openTutorial;

  document.getElementById('test-btn-sb').onclick = async () => {
    await ensureAudioSetup();
    if (currentInstrument) currentInstrument.triggerAttackRelease('C4', '2n');
    completeChallenge('first_note');
  };

  // Sandbox selects
  document.getElementById('osc-type-sb').onchange   = e => { if (synth) synth.oscillator.type = e.target.value; };
  document.getElementById('synth-type-sb').onchange = e => updateInstrument(e.target.value);
  document.getElementById('filter-type-sb').onchange = e => { if (filter) { filter.type = e.target.value; drawFilterCurve('filterCurveCanvas-sb'); } };

  document.getElementById('master-vol-sb').oninput = e => {
    masterVol.volume.value = e.target.value;
    document.getElementById('val-vol-sb').textContent = e.target.value + 'dB';
  };

  // Sequencer
  document.getElementById('seq-play').onclick = async () => {
    await ensureAudioSetup();
    Tone.Transport.toggle();
    const playing = Tone.Transport.state === 'started';
    const btn = document.getElementById('seq-play');
    btn.textContent = playing ? '■ ATURAR' : '▶ REPRODUIR';
    btn.classList.toggle('playing', playing);
    document.querySelector('.playing-state').style.display = playing ? 'block' : 'none';
    if (playing) completeChallenge('play_seq');
  };

  document.getElementById('seq-clear').onclick = () => {
    grid = grid.map(r => r.fill(false));
    document.querySelectorAll('.grid-cell').forEach(c => { c.classList.remove('on'); c.setAttribute('aria-pressed','false'); });
  };

  document.getElementById('bpm-slider').oninput = e => {
    Tone.Transport.bpm.value = e.target.value;
    document.getElementById('bpm-val').textContent = e.target.value;
  };

  // Presets
  const presets = {
    techno:   [[12,0],[12,4],[12,8],[12,12],[6,2],[6,6],[6,10],[6,14]],
    arpeggio: [[12,0],[9,2],[7,4],[5,6],[12,8],[9,10],[7,12],[5,14]],
    trance:   [[12,0],[12,4],[12,8],[12,12],[2,2],[2,6],[2,10],[2,14],[0,3],[0,7],[0,11]],
    pop:      [[12,0],[8,0],[5,0],[12,4],[8,4],[5,4],[12,8],[8,8],[5,8],[12,12],[8,12],[5,12]],
    bass:     [[12,0],[12,1],[10,2],[12,4],[12,5],[10,6],[7,8]],
    ambient:  [[0,0],[4,2],[7,4],[11,6]]
  };
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('seq-clear').click();
      const rows = document.querySelectorAll('.grid-row');
      presets[btn.dataset.preset].forEach(([r, c]) => {
        grid[r][c] = true;
        rows[r].children[c].classList.add('on');
        rows[r].children[c].setAttribute('aria-pressed', 'true');
      });
      completeChallenge('load_preset');
    };
  });

  // Save / Load / Export
  document.getElementById('seq-save').onclick   = saveGrid;
  document.getElementById('seq-load').onclick   = loadGrid;
  document.getElementById('seq-export').onclick = exportGrid;

  // Drop zone
  const dz = document.getElementById('drop-zone');
  dz.ondragover  = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop      = e => { e.preventDefault(); dz.classList.remove('dragover'); loadSample(e.dataTransfer.files[0]); };
  document.getElementById('sample-file').onchange = e => loadSample(e.target.files[0]);

  async function loadSample(file) {
    if (!file) return;
    await ensureAudioSetup();
    const url = URL.createObjectURL(file);
    const buffer = await new Tone.ToneAudioBuffer(url);
    if (sampler) sampler.dispose();
    sampler = new Tone.Sampler({ urls:{ C4: buffer }, onload: () => {
      dz.classList.add('loaded');
      document.getElementById('file-name').textContent = file.name;
      document.getElementById('synth-type-sb').value = 'sampler';
      updateInstrument('sampler');
    }}).connect(filter || masterVol);
  }

  document.getElementById('clear-sample').onclick = () => {
    if (sampler) { sampler.dispose(); sampler = null; }
    dz.classList.remove('loaded');
    document.getElementById('file-name').textContent = '';
    document.getElementById('synth-type-sb').value = 'synth';
    updateInstrument('synth');
  };

  // Challenges toggle
  // Use offsetHeight to reliably detect visibility regardless of how display was last set.
  document.getElementById('challenges-toggle').onclick = () => {
    const content = document.getElementById('challenges-content');
    const arrow   = document.getElementById('ch-arrow');
    const btn     = document.getElementById('challenges-toggle');
    const isVisible = content.offsetHeight > 0;
    content.style.display = isVisible ? 'none' : 'flex';
    btn.setAttribute('aria-expanded', String(!isVisible));
    if (arrow) arrow.textContent = isVisible ? '▶' : '▼';
  };

  // Tutorial
  document.getElementById('tut-close').onclick = closeTutorial;
  document.getElementById('tut-next').onclick  = () => { if (tutStep < TUT_TOTAL-1) { tutStep++; renderTutStep(); } else closeTutorial(); };
  document.getElementById('tut-prev').onclick  = () => { if (tutStep > 0) { tutStep--; renderTutStep(); } };
  document.getElementById('footer-tutorial')?.addEventListener('click', e => { e.preventDefault(); openTutorial(); });

  // Info modal
  document.getElementById('info-close').onclick = () => document.getElementById('info-modal').style.display = 'none';
  document.querySelectorAll('.info-btn').forEach(btn => {
    btn.onclick = () => openInfoModal(btn.dataset.title, btn.dataset.body);
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
  });

  renderTutStep();
});
