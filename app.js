/**
 * ADSR-Canvas Premium — core audio engine & UI logic
 */

// --- Global State & Tone.js Setup ---
let synth;
let sampler;
let currentInstrument;
let analyzer, waveform;
let filter, reverb, delay;
let isFrozen = false; // Flag to freeze visualizers
const masterVol = new Tone.Volume(-8).toDestination();

// ADSR state
const adsr = { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.4 };

// --- Knob Component Class ---
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

    // Create canvas for drawing the knob
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el.appendChild(this.canvas);
    this.resize();

    this.initEvents();
    this.draw();
  }

  resize() {
    this.size = this.el.offsetWidth || 64;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.ctx.scale(dpr, dpr);
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', e => {
      this.isDragging = true;
      this.startY = e.clientY;
      this.startVal = this.val;
      document.body.style.cursor = 'ns-resize';
    });

    window.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      const delta = (this.startY - e.clientY) * 0.01;
      const range = this.max - this.min;
      let newVal = this.startVal + delta * range;
      this.update(newVal);
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        document.body.style.cursor = 'default';
      }
    });

    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
  }

  update(newVal) {
    this.val = Math.min(this.max, Math.max(this.min, newVal));
    // Snap to step
    if (this.step < 1) {
      const p = 1 / this.step;
      this.val = Math.round(this.val * p) / p;
    } else {
      this.val = Math.round(this.val / this.step) * this.step;
    }
    this.draw();
    if (this.onChange) this.onChange(this.val);
  }

  draw() {
    const ctx = this.ctx;
    const s = this.size;
    const center = s / 2;
    const radius = s * 0.4;
    const isMag = this.el.id.includes('rev') || this.el.id.includes('del');
    const accent = isMag ? '#FF00FF' : '#00FFCC';

    ctx.clearRect(0, 0, s, s);

    // Track arc
    ctx.beginPath();
    ctx.arc(center, center, radius, 0.75 * Math.PI, 2.25 * Math.PI);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    const ratio = (this.val - this.min) / (this.max - this.min);
    const endAngle = 0.75 * Math.PI + ratio * 1.5 * Math.PI;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0.75 * Math.PI, endAngle);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Knob body
    ctx.beginPath();
    ctx.arc(center, center, radius - 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Indicator line
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(endAngle);
    ctx.beginPath();
    ctx.moveTo(radius - 12, 0);
    ctx.lineTo(radius - 6, 0);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

// --- Initialization ---
async function init() {
  if (Tone.context.state === 'running') return;
  await Tone.start();
  console.log("Audio is ready");

  // Chain: Filter -> Reverb -> Delay -> MasterVol
  filter = new Tone.Filter(2000, "lowpass");
  reverb = new Tone.Reverb({ decay: 1.5, wet: 0.3 });
  delay = new Tone.FeedbackDelay({ delayTime: "4n", feedback: 0.4, wet: 0.2 });

  // Connect chain
  filter.connect(reverb);
  reverb.connect(delay);
  delay.connect(masterVol);

  // Visualizers hook
  analyzer = new Tone.FFT(32);
  waveform = new Tone.Waveform(1024);
  masterVol.connect(analyzer);
  masterVol.connect(waveform);

  updateInstrument("synth");
  initKnobs();
  drawVisualizers();
  drawFilterCurve();
}

const updateInstrument = (type) => {
  if (synth) synth.dispose();
  if (sampler) sampler.dispose();

  const common = { 
    envelope: { ...adsr },
    oscillator: { type: document.getElementById('osc-type').value }
  };

  if (type === "sampler") {
    currentInstrument = sampler;
  } else {
    const synths = {
      synth: Tone.Synth,
      amsynth: Tone.AMSynth,
      fmsynth: Tone.FMSynth,
      monosynth: Tone.MonoSynth
    };
    synth = new synths[type](common).connect(filter);
    currentInstrument = synth;
  }
  document.body.dataset.inst = type;
};

// --- Knob Initialization & Handlers ---
function initKnobs() {
  new Knob(document.getElementById('knob-cutoff'), val => {
    if (filter) filter.frequency.value = val;
    document.getElementById('val-cutoff').innerText = val > 1000 ? (val/1000).toFixed(1)+'k' : Math.round(val);
    drawFilterCurve();
  });
  new Knob(document.getElementById('knob-res'), val => {
    if (filter) filter.Q.value = val;
    document.getElementById('val-res').innerText = val.toFixed(1);
    drawFilterCurve();
  });

  new Knob(document.getElementById('knob-rev-decay'), val => {
    if (reverb) reverb.decay = val;
    document.getElementById('val-rev-decay').innerText = val.toFixed(1) + 's';
  });
  new Knob(document.getElementById('knob-rev-mix'), val => {
    if (reverb) reverb.wet.value = val;
    document.getElementById('val-rev-mix').innerText = Math.round(val * 100) + '%';
  });

  new Knob(document.getElementById('knob-del-time'), val => {
    if (delay) delay.delayTime.value = val;
    document.getElementById('val-del-time').innerText = Math.round(val * 1000) + 'ms';
  });
  new Knob(document.getElementById('knob-del-fback'), val => {
    if (delay) delay.feedback.value = val;
    document.getElementById('val-del-fback').innerText = Math.round(val * 100) + '%';
  });
  new Knob(document.getElementById('knob-del-mix'), val => {
    if (delay) delay.wet.value = val;
    document.getElementById('val-del-mix').innerText = Math.round(val * 100) + '%';
  });
}

// --- Filter Curve Drawing ---
function drawFilterCurve() {
  const canvas = document.getElementById('filterCurveCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.parentElement.offsetWidth;
  const h = canvas.height = canvas.parentElement.offsetHeight;
  
  ctx.clearRect(0, 0, w, h);
  if (!filter) return;
  
  const freq = filter.frequency.value;
  const Q = filter.Q.value;
  const type = filter.type;

  ctx.beginPath();
  ctx.strokeStyle = '#00FFCC';
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = 'rgba(0,255,204,0.5)';

  for (let x = 0; x < w; x++) {
    const f = Math.pow(10, (x / w) * Math.log10(20000 / 20)) * 20;
    let gain = 1;

    if (type === 'lowpass') {
      gain = 1 / Math.sqrt(1 + Math.pow(f / freq, 4));
      if (f > freq * 0.8 && f < freq * 1.2) gain *= (1 + Q/10); 
    } else if (type === 'highpass') {
      gain = 1 / Math.sqrt(1 + Math.pow(freq / f, 4));
    } else if (type === 'bandpass') {
      const bw = freq / Q;
      gain = Math.exp(-Math.pow(f - freq, 2) / (2 * Math.pow(bw, 2)));
    } else if (type === 'notch') {
      const bw = freq / Q;
      gain = 1 - Math.exp(-Math.pow(f - freq, 2) / (2 * Math.pow(bw, 2)));
    }

    const y = h - (gain * h * 0.8) - 10;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// --- Visualizers ---
function drawVisualizers() {
  const fftC = document.getElementById('fftCanvas');
  const oscC = document.getElementById('oscCanvas');
  const fftCtx = fftC.getContext('2d');
  const oscCtx = oscC.getContext('2d');

  const render = () => {
    requestAnimationFrame(render);
    
    // If frozen, skip redrawing but keep current state on canvas
    if (isFrozen) return;

    // Resize if needed
    if (fftC.width !== fftC.parentElement.offsetWidth) {
      fftC.width = fftC.parentElement.offsetWidth;
      fftC.height = 180;
      oscC.width = oscC.parentElement.offsetWidth;
      oscC.height = 180;
    }

    if (!analyzer || !waveform) return;

    // FFT
    const data = analyzer.getValue();
    fftCtx.fillStyle = '#0e0e0e';
    fftCtx.fillRect(0, 0, fftC.width, fftC.height);
    const barW = fftC.width / data.length;
    data.forEach((v, i) => {
      const h = Math.max(2, (v + 100) * 1.8);
      const grad = fftCtx.createLinearGradient(0, fftC.height-h, 0, fftC.height);
      grad.addColorStop(0, '#00FFCC');
      grad.addColorStop(1, '#FF00FF');
      fftCtx.fillStyle = grad;
      fftCtx.fillRect(i * barW, fftC.height - h, barW - 2, h);
    });

    // OSC
    const wave = waveform.getValue();
    oscCtx.fillStyle = '#0e0e0e';
    oscCtx.fillRect(0, 0, oscC.width, oscC.height);
    oscCtx.beginPath();
    oscCtx.strokeStyle = '#FF00FF';
    oscCtx.lineWidth = 2;
    oscCtx.shadowBlur = 10;
    oscCtx.shadowColor = 'rgba(255,0,255,0.5)';
    const slice = oscC.width / wave.length;
    wave.forEach((v, i) => {
      const x = i * slice;
      const y = (v + 1) / 2 * oscC.height;
      if (i === 0) oscCtx.moveTo(x, y);
      else oscCtx.lineTo(x, y);
    });
    oscCtx.stroke();
    oscCtx.shadowBlur = 0;
  };
  render();
}

// --- ADSR Canvas Editor ---
const setupADSR = () => {
  const canvas = document.getElementById('adsrCanvas');
  const ctx = canvas.getContext('2d');
  let nodes = [
    { id: 'A', x: 0.1, y: 0.1 },
    { id: 'D', x: 0.3, y: 0.4 },
    { id: 'S', x: 0.7, y: 0.4 },
    { id: 'R', x: 0.9, y: 1.0 }
  ];
  let activeNode = null;

  const draw = () => {
    const w = canvas.width = canvas.parentElement.offsetWidth;
    const h = canvas.height = canvas.parentElement.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for(let i=0; i<10; i++) {
      ctx.beginPath(); ctx.moveTo(i*w/10, 0); ctx.lineTo(i*w/10, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*h/10); ctx.lineTo(w, i*h/10); ctx.stroke();
    }

    // Curve
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(nodes[0].x * w, nodes[0].y * h);
    ctx.lineTo(nodes[1].x * w, nodes[1].y * h);
    ctx.lineTo(nodes[2].x * w, nodes[2].y * h);
    ctx.lineTo(nodes[3].x * w, nodes[3].y * h);
    ctx.strokeStyle = '#00FFCC';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill
    ctx.lineTo(nodes[3].x * w, h);
    ctx.lineTo(0, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,255,204,0.2)');
    grad.addColorStop(1, 'rgba(0,255,204,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Nodes
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#00FFCC';
      ctx.shadowBlur = 10; ctx.shadowColor = '#00FFCC';
      ctx.fill();
      ctx.strokeStyle = '#FF00FF';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = '#fff';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(n.id, n.x * w - 3, n.y * h - 12);
    });
    
    updateParams();
  };

  const updateParams = () => {
    adsr.attack = nodes[0].x * 2;
    adsr.decay = (nodes[1].x - nodes[0].x) * 2;
    adsr.sustain = 1 - nodes[1].y;
    adsr.release = (nodes[3].x - nodes[2].x) * 2;
    
    document.getElementById('val-attack').innerText = adsr.attack.toFixed(2) + 's';
    document.getElementById('val-decay').innerText = adsr.decay.toFixed(2) + 's';
    document.getElementById('val-sustain').innerText = adsr.sustain.toFixed(2);
    document.getElementById('val-release').innerText = adsr.release.toFixed(2) + 's';

    if (currentInstrument && currentInstrument.envelope) {
      currentInstrument.envelope.set(adsr);
    }
  };

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    activeNode = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < 0.05);
  });

  window.addEventListener('mousemove', e => {
    if (!activeNode) return;
    const rect = canvas.getBoundingClientRect();
    let mx = (e.clientX - rect.left) / rect.width;
    let my = (e.clientY - rect.top) / rect.height;
    mx = Math.max(0, Math.min(1, mx));
    my = Math.max(0, Math.min(1, my));

    if (activeNode.id === 'A') { mx = Math.min(mx, nodes[1].x - 0.01); }
    if (activeNode.id === 'D') { mx = Math.max(mx, nodes[0].x + 0.01); mx = Math.min(mx, nodes[2].x - 0.01); }
    if (activeNode.id === 'S') { mx = Math.max(mx, nodes[1].x + 0.01); mx = Math.min(mx, nodes[3].x - 0.01); my = nodes[1].y; }
    if (activeNode.id === 'R') { mx = Math.max(mx, nodes[2].x + 0.01); }

    activeNode.x = mx;
    if (activeNode.id !== 'S' && activeNode.id !== 'R') activeNode.y = my;
    if (activeNode.id === 'D' || activeNode.id === 'S') {
      nodes[1].y = nodes[2].y = my;
    }
    draw();
  });

  window.addEventListener('mouseup', () => activeNode = null);
  window.addEventListener('resize', draw);
  draw();
};

// --- Sequencer Logic ---
const notes = ["C4", "B3", "Bb3", "A3", "Ab3", "G3", "Gb3", "F3", "E3", "Eb3", "D3", "Db3", "C3"];
let grid = Array(notes.length).fill().map(() => Array(16).fill(false));
let step = 0;

const setupSequencer = () => {
  const labelCont = document.getElementById('note-labels');
  const gridCont = document.getElementById('seq-grid');

  notes.forEach((note, i) => {
    const lb = document.createElement('div');
    lb.className = `note-label ${note.includes('b') ? 'sharp' : ''}`;
    lb.innerText = note;
    labelCont.appendChild(lb);

    const row = document.createElement('div');
    row.className = 'grid-row';
    for(let j=0; j<16; j++) {
      const cell = document.createElement('div');
      cell.className = `grid-cell ${j % 4 === 0 ? 'beat' : ''}`;
      cell.onclick = () => {
        grid[i][j] = !grid[i][j];
        cell.classList.toggle('on', grid[i][j]);
      };
      row.appendChild(cell);
    }
    gridCont.appendChild(row);
  });

  Tone.Transport.scheduleRepeat(time => {
    grid.forEach((row, i) => {
      if (row[step]) {
        currentInstrument.triggerAttackRelease(notes[i], "16n", time);
        createRipple(i, step);
      }
    });
    
    const cells = document.querySelectorAll('.grid-cell');
    cells.forEach(c => c.classList.remove('ph'));
    const rows = document.querySelectorAll('.grid-row');
    rows.forEach(r => r.children[step].classList.add('ph'));

    step = (step + 1) % 16;
  }, "16n");
};

const createRipple = (rowIdx, colIdx) => {
  const rows = document.querySelectorAll('.grid-row');
  const cell = rows[rowIdx].children[colIdx];
  const r = document.createElement('div');
  r.className = 'ripple';
  cell.appendChild(r);
  setTimeout(() => r.remove(), 500);
};

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
  setupADSR();
  setupSequencer();

  const splash = document.getElementById('splash-overlay');
  const startBtn = document.getElementById('start-app');
  startBtn.onclick = async () => {
    await init();
    splash.classList.add('hidden');
    setTimeout(() => splash.style.display = 'none', 500);
  };

  document.getElementById('synth-type').onchange = e => updateInstrument(e.target.value);
  document.getElementById('osc-type').onchange = e => {
    if (synth) synth.oscillator.type = e.target.value;
  };
  document.getElementById('filter-type').onchange = e => {
    if (filter) filter.type = e.target.value;
    drawFilterCurve();
  };
  
  document.getElementById('test-btn').onclick = async () => {
    if (Tone.context.state !== 'running') await init();
    currentInstrument.triggerAttackRelease("C4", "2n");
  };

  document.getElementById('master-vol').oninput = e => {
    masterVol.volume.value = e.target.value;
    document.getElementById('val-vol').innerText = e.target.value + 'dB';
  };

  document.getElementById('seq-play').onclick = async () => {
    if (Tone.context.state !== 'running') await init();
    Tone.Transport.toggle();
    const isPlaying = Tone.Transport.state === 'started';
    
    // Toggle visualizer freeze on play
    isFrozen = isPlaying;
    
    const btn = document.getElementById('seq-play');
    btn.innerText = isPlaying ? "■ STOP" : "▶ PLAY";
    btn.classList.toggle('playing', isPlaying);
    document.querySelector('.playing-state').style.display = isPlaying ? 'block' : 'none';
  };

  document.getElementById('seq-clear').onclick = () => {
    grid = grid.map(r => r.fill(false));
    document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('on'));
  };

  document.getElementById('bpm-slider').oninput = e => {
    Tone.Transport.bpm.value = e.target.value;
    document.getElementById('bpm-val').innerText = e.target.value;
  };

  const dz = document.getElementById('drop-zone');
  dz.ondragover = () => { dz.classList.add('dragover'); return false; };
  dz.ondragleave = () => { dz.classList.remove('dragover'); return false; };
  dz.ondrop = e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    loadSample(file);
  };
  document.getElementById('sample-file').onchange = e => loadSample(e.target.files[0]);

  async function loadSample(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const buffer = await new Tone.ToneAudioBuffer(url);
    if (sampler) sampler.dispose();
    sampler = new Tone.Sampler({
      urls: { C4: buffer },
      onload: () => {
        dz.classList.add('loaded');
        document.getElementById('file-name').innerText = file.name;
        document.getElementById('synth-type').value = "sampler";
        updateInstrument("sampler");
      }
    }).connect(filter || masterVol);
  }

  const presets = {
    techno: [[12,0],[12,4],[12,8],[12,12],[6,2],[6,6],[6,10],[6,14]],
    arpeggio: [[12,0],[9,2],[7,4],[5,6],[12,8],[9,10],[7,12],[5,14]],
    trance: [[12,0],[12,4],[12,8],[12,12],[2,2],[2,6],[2,10],[2,14],[0,3],[0,7],[0,11]],
    pop: [[12,0],[8,0],[5,0],[12,4],[8,4],[5,4],[12,8],[8,8],[5,8],[12,12],[8,12],[5,12]],
    bass: [[12,0],[12,1],[10,2],[12,4],[12,5],[10,6],[7,8]],
    ambient: [[0,0],[4,2],[7,4],[11,6]]
  };

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('seq-clear').click();
      const p = presets[btn.dataset.preset];
      const rows = document.querySelectorAll('.grid-row');
      p.forEach(([r, c]) => {
        grid[r][c] = true;
        rows[r].children[c].classList.add('on');
      });
    };
  });
});
