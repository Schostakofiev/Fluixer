let editHistory = null, imageHistoryPending = 0;
let compensatedPreview = false;
let importedCsv = null, csvReadId = 0, csvReading = false;
let calibPreviewPending = false, calibPreviewReading = false, calibPreviousPreview = null;
let animatedCache = null, viewDrawFrame = null;
function requestViewDraw() {
  if (viewDrawFrame !== null) return;
  viewDrawFrame = window.requestAnimationFrame(() => {
    viewDrawFrame = null;
    draw();
  });
}
let spatialWindows = [],
  spatialErase = false,
  spatialStroke = null;
function uiColor(name, fallback) {
  return typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement)
        .getPropertyValue('--' + name)
        .trim() || fallback
    : fallback;
}
const $ = (id) => document.getElementById(id),
  canvas = $('preview'),
  ctx = canvas.getContext('2d');
let renderMode = 'lines',
  innerDiameter = 2,
  tubeRenderer = null;
let planeVisible = false,
  tubeCenter = null;
let initialPlacement = null,
  placement = null,
  planeHandles = [],
  planeDrag = null;
let display = null,
  yaw = -0.55,
  pitch = 0.25,
  zoom = 1,
  panX = 0,
  panY = 0,
  requestId = 0,
  exporting = false;
let projectBusy = false,
  previewLoading = false,
  previewQueued = false,
  previewTask = null;
let animationProgress = 1,
  animationPlaying = false,
  animationFrame = null,
  animationTime = null;
let motionCache = null,
  motionSource = null;
function stopAnimation(refresh = true) {
  animationPlaying = false;
  animationTime = null;
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (refresh) syncPlayback();
}
function syncSliderFill(input) {
  const min = Number(input.min || 0),
    max = Number(input.max || 100),
    value = Number(input.value);
  const fraction =
    max > min && Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  input.style.backgroundSize = `calc(${16 * (0.5 - fraction)}px + ${fraction * 100}%) 100%`;
}
function selectedStepLength() {
  const value = Number($('length-per-100-steps').value);
  if (!Number.isFinite(value) || value <= 0)
    throw Error('100 Steps Length must be a positive number in mm');
  return value;
}
function selectedPreAdd() {
  const raw = $('pre-add').value,
    value = Number(raw);
  if (String(raw).trim() === '' || !Number.isFinite(value) || value < 0 || value > 10000)
    throw Error('Pre-Add must be between 0 and 10000 mm');
  return value;
}
function setPreAdd(value) {
  $('pre-add').value = value;
}
setPreAdd(730);
function syncPlayback() {
  syncCsvControls();
  syncSpatialControls();
  const play = $('playback-play');
  play.classList.toggle('is-playing', animationPlaying);
  play.ariaLabel = play.title = animationPlaying ? 'Pause' : 'Play';
  for (const id of [
    'playback-play',
    'playback-start',
    'playback-final',
    'playback-progress',
    'playback-rate',
  ])
    $(id).disabled = !display || projectBusy || previewLoading || csvReading;
  syncPlaybackProgress();
}
// Per-frame updates never refresh unrelated controls or start requests.
function syncPlaybackProgress() {
  $('playback-progress').value = Math.round(animationProgress * 1000);
  syncSliderFill($('playback-progress'));
  $('playback-progress').ariaValueText = Math.round(animationProgress * 100) + '%';
  syncCurrentOutput();
}
function resetAnimation(refresh = true) {
  stopAnimation(false);
  animationProgress = 1;
  motionCache = null;
  motionSource = null;
  if (refresh) syncPlayback();
}
// CSV_PREVIEW_CORE_START
function parsePreviewCsv(source, settings) {
  if (typeof source !== 'string' || source.length > 4194304)
    throw Error('CSV exceeds the 4 MB limit');
  const kGas = Math.trunc(Number(settings.kGas)),
    kLiquid = Math.trunc(Number(settings.kLiquid)),
    preAdd = Number(settings.preAdd),
    stepLength = Number(settings.lengthPer100Steps);
  if (![kGas, kLiquid].every(v => Number.isFinite(v) && v > 0))
    throw Error('k_Gas and k_Liquid must be at least 1 for CSV preview');
  if (!Number.isFinite(preAdd) || preAdd < 0 || preAdd > 10000)
    throw Error('Pre-Add must be between 0 and 10000 mm');
  if (!Number.isFinite(stepLength) || stepLength <= 0)
    throw Error('100 Steps Length must be a positive number in mm');
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const finishField = () => { row.push(field.trim()); field = ''; closed = false; };
  const finishRow = () => {
    finishField();
    if (row.some(v => v !== '')) rows.push({ values: row, line: rowLine });
    row = [];
    if (rows.length > 10001) throw Error('CSV exceeds the 10000 command limit');
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        field += ch;
        if (ch === '\n') line++;
      }
    } else if (ch === ',') finishField();
    else if (ch === '\n') { finishRow(); rowLine = ++line; }
    else if (ch === '"' && !field.trim() && !closed) { field = ''; quoted = true; }
    else if (ch === '"' || (closed && !/\s/.test(ch))) throw Error(`Line ${line}: invalid CSV quoting`);
    else field += ch;
  }
  if (quoted) throw Error(`Line ${rowLine}: unclosed quoted field`);
  if (field || row.length || closed) finishRow();
  const header = ['type', 'motor', 'direction', 'steps', 'speed', 'unit', 'seconds'];
  if (!rows.length || rows[0].values.map(v => v.toLowerCase()).join(',') !== header.join(','))
    throw Error('Expected CSV header: ' + header.join(','));
  if (rows.length < 2) throw Error('CSV contains no commands');
  const commands = [], outputCommands = [], units = new Set();
  let total = 0;
  const number = (raw, name, line) => {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw)))
      throw Error(`Line ${line}: invalid ${name}`);
    return Number(raw);
  };
  for (const { values, line } of rows.slice(1)) {
    if (values.length !== 7) throw Error(`Line ${line}: expected 7 columns`);
    const [type, motor, direction, value, speed, unit, seconds] = values.map(v => v.toLowerCase());
    if (type !== 'move' || !['g', 'l'].includes(motor) || direction !== 'fwd')
      throw Error(`Line ${line}: only move, g/l and fwd commands are supported`);
    if (!['steps', 'segments'].includes(unit)) throw Error(`Line ${line}: invalid unit`);
    const amount = number(value, 'command value', line);
    number(speed, 'speed', line);
    if (amount <= 0 || amount > 1e9 || (unit === 'segments' && !Number.isInteger(amount)))
      throw Error(`Line ${line}: invalid command value`);
    if (seconds !== '' && number(seconds, 'seconds', line) !== 0)
      throw Error(`Line ${line}: timed commands are not supported`);
    const steps = unit === 'segments' ? amount * 200 / 3 : amount;
    const length = steps * 625 / (motor === 'g' ? kGas : kLiquid) * stepLength / 100;
    total += length;
    if (!Number.isFinite(total) || total > 1e8) throw Error('CSV sequence is too long');
    const phase = motor === 'g' ? 'gas' : 'liquid';
    outputCommands.push({ phase, length, steps });
    if (commands.length && commands[commands.length - 1].phase === phase)
      commands[commands.length - 1].length += length;
    else commands.push({ phase, length });
    units.add(unit);
  }
  // Pre-Add belongs to the final gas command. Exclude it from preview only;
  // preserve the imported command sequence and its total for CSV fidelity.
  const previewCommands = commands.map(command => ({ ...command }));
  const tail = previewCommands[previewCommands.length - 1];
  const omittedPreAdd = tail?.phase === 'gas' ? Math.min(preAdd, tail.length) : 0;
  if (omittedPreAdd > 0) {
    tail.length -= omittedPreAdd;
    if (tail.length <= 1e-8) previewCommands.pop();
  }
  const previewTotal = previewCommands.reduce((sum, command) => sum + command.length, 0);
  return { commands, outputCommands, total, previewCommands, previewTotal, preAdd, omittedPreAdd,
    kGas, kLiquid, lengthPer100Steps: stepLength, rows: rows.length - 1, approximate: units.has('segments') };
}
function csvPreviewWindows(sequence, pathLength, progress) {
  const pumped = Math.max(0, Math.min(1, progress)) * sequence.previewTotal;
  const windows = [];
  let injected = 0;
  for (const command of sequence.previewCommands) {
    const start = Math.max(0, pumped - injected - command.length);
    const end = Math.min(pathLength, pumped - injected);
    if (command.phase === 'liquid' && end > start) windows.push([start, end]);
    injected += command.length;
  }
  // Injection order is opposite to increasing distance along the tube.
  return windows.reverse();
}
// CSV_PREVIEW_CORE_END

// CURRENT_OUTPUT_CORE_START
function roundOutputSteps(value) {
  // Match Python round, including half-to-even ties.
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + (lower % 2) : Math.round(value);
}
function outputTimeline(segments, settings) {
  const kGas = Math.trunc(Number(settings.kGas)), kLiquid = Math.trunc(Number(settings.kLiquid));
  const stepLength = Number(settings.lengthPer100Steps), preAdd = Number(settings.preAdd);
  if (![kGas, kLiquid, preAdd].every(v => Number.isFinite(v) && v >= 0) ||
      !Number.isFinite(stepLength) || stepLength <= 0) return { commands: [], total: 0 };
  // Match the animation's injection order: omit the unfilled terminal gas.
  let last = segments.length - 1;
  while (last >= 0 && segments[last].phase !== 'liquid') last--;
  const visible = segments.slice(0, last + 1);
  const total = visible.reduce((sum, command) => sum + command.length, 0);
  const commands = visible.map((command, index) => {
    const length = command.length + (index === 0 && command.phase === 'gas' ? preAdd : 0);
    const value = Number((Number(length.toFixed(6)) / (stepLength / 100)).toFixed(6));
    const steps = Math.max(1, value * (command.phase === 'gas' ? kGas : kLiquid) / 625);
    const unit = settings.unit === 'segments' ? 'segments' : 'steps';
    const amount = unit === 'segments' ? Math.max(1, Math.floor(steps * 3 / 200 + 0.5)) : Math.max(1, roundOutputSteps(steps));
    return { phase: command.phase, length, amount, unit, split: unit === 'segments' ? 89 : 2000 };
  }).reverse();
  return { commands, total };
}
function outputAtProgress(commands, total, progress) {
  if (!(total > 0) || !commands.length) return null;
  const distance = Math.max(0, Math.min(1, progress)) * total;
  let start = 0;
  for (const command of commands) {
    const end = start + command.length;
    if (command.length > 0 && (distance < end || (progress >= 1 && distance <= end + 1e-8))) {
      let amount = command.amount ?? command.steps;
      if (command.split) {
        const passed = Math.max(0, Math.min(1, (distance - start) / command.length)) * amount;
        const index = Math.min(Math.ceil(amount / command.split) - 1, Math.floor(passed / command.split));
        amount = Math.min(command.split, amount - index * command.split);
      }
      return { phase: command.phase, amount, unit: command.unit || 'steps' };
    }
    start = end;
  }
  return null;
}
function currentOutputText(command, unit) {
  if (!command || !Number.isFinite(command.amount)) return { text: '—', unit };
  const amount = command.unit === unit ? command.amount
    : unit === 'segments' ? command.amount * 3 / 200 : command.amount * 200 / 3;
  return {
    text: `${command.phase === 'liquid' ? 'L' : 'G'} ${unit === 'steps' ? roundOutputSteps(amount) : Number(amount.toFixed(2))}`,
    unit,
  };
}
// CURRENT_OUTPUT_CORE_END

var currentOutputCache;
function syncCurrentOutput() {
  const el = $('current-output-value');
  const unitLabel = $('current-output-unit');
  unitLabel.textContent = $('unit').value === 'segments' ? 'segments' : 'steps';
  if (!display || previewLoading || projectBusy || csvReading) { el.textContent = '—'; return; }
  const unit = $('unit').value === 'segments' ? 'segments' : 'steps';
  let timeline;
  if (importedCsv) {
    timeline = { commands: importedCsv.outputCommands, total: importedCsv.previewTotal };
  } else {
    const settings = { kGas: $('k-gas').value, kLiquid: $('k-liquid').value,
      lengthPer100Steps: $('length-per-100-steps').value, preAdd: $('pre-add').value, unit };
    const key = JSON.stringify(settings);
    if (currentOutputCache?.display !== display || currentOutputCache.key !== key)
      currentOutputCache = { display, key, timeline: outputTimeline(display.segments, settings) };
    timeline = currentOutputCache.timeline;
  }
  const command = outputAtProgress(timeline.commands, timeline.total, animationProgress);
  const output = currentOutputText(command, unit);
  el.textContent = output.text;
  unitLabel.textContent = output.unit;
}
for (const id of ['k-gas', 'k-liquid', 'length-per-100-steps', 'pre-add'])
  $(id).addEventListener('input', syncCurrentOutput);
$('unit').addEventListener('change', syncCurrentOutput);


function movingWindows(segments, length, progress) {
  // Injection order is reversed: the last liquid in the final path enters first.
  // Start with its leading boundary at the inlet, skipping terminal gas only.
  let position = 0,
    lastLiquidEnd = 0;
  for (const s of segments) {
    position += s.length;
    if (s.phase === 'liquid') lastLiquidEnd = position;
  }
  const shift = (Math.max(0, Math.min(1, progress)) - 1) * lastLiquidEnd,
    result = [];
  position = 0;
  for (const s of segments) {
    const start = Math.max(0, position + shift),
      end = Math.min(length, position + s.length + shift);
    if (s.phase === 'liquid' && end > start) result.push([start, end]);
    position += s.length;
  }
  return result;
}
function motionGeometry(data) {
  const edges = [];
  let position = 0;
  for (const segment of data.segments) {
    const lengths = segment.points
        .slice(1)
        .map((p, i) => Math.hypot(...p.map((v, j) => v - segment.points[i][j]))),
      total = lengths.reduce((a, b) => a + b, 0);
    let local = 0;
    for (let i = 0; i < lengths.length; i++) {
      const next = local + (total ? (lengths[i] / total) * segment.length : 0);
      if (next > local)
        edges.push({
          a: segment.points[i],
          b: segment.points[i + 1],
          start: position + local,
          end: position + next,
        });
      local = next;
    }
    position += segment.length;
  }
  return edges;
}
function animatedSegments(data, progress) {
  if (animatedCache?.data === data && animatedCache.csv === importedCsv && animatedCache.progress === progress)
    return animatedCache.segments;
  const segments = computeAnimatedSegments(data, progress);
  animatedCache = { data, csv: importedCsv, progress, segments };
  return segments;
}
function computeAnimatedSegments(data, progress) {
  if (!importedCsv && progress >= 1) return data.segments;
  if (motionSource !== data) {
    motionCache = motionGeometry(data);
    motionSource = data;
  }
  const result = data.segments.map((s) => ({ phase: 'gas', points: s.points }));
  const interpolate = (edge, d) =>
    edge.a.map((v, j) => v + ((edge.b[j] - v) * (d - edge.start)) / (edge.end - edge.start));
  let cursor = 0;
  const windows = importedCsv
    ? csvPreviewWindows(importedCsv, data.path_length, progress)
    : movingWindows(data.segments, data.path_length, progress);
  for (const [start, end] of windows) {
    while (cursor < motionCache.length && motionCache[cursor].end <= start) cursor++;
    for (let i = cursor; i < motionCache.length && motionCache[i].start < end; i++) {
      const edge = motionCache[i],
        a = Math.max(start, edge.start),
        b = Math.min(end, edge.end);
      if (b > a)
        result.push({ phase: 'liquid', points: [interpolate(edge, a), interpolate(edge, b)] });
    }
  }
  return result;
}
function animationTick(time) {
  animationFrame = null;
  if (!animationPlaying || !display) return;
  const rate = Number($('playback-rate').value) || 1;
  if (animationTime !== null)
    animationProgress = Math.min(
      1,
      animationProgress + (Math.max(0, time - animationTime) / 20000) * rate,
    );
  animationTime = time;
  if (animationProgress >= 1) {
    animationPlaying = false;
    animationTime = null;
  }
  if (animationPlaying) syncPlaybackProgress();
  else syncPlayback();
  draw();
  if (animationPlaying) animationFrame = window.requestAnimationFrame(animationTick);
}
$('playback-play').addEventListener('click', () => {
  if (!display || projectBusy || previewLoading) return;
  if (animationPlaying) {
    stopAnimation();
    return;
  }
  if (animationProgress >= 1) animationProgress = 0;
  animationPlaying = true;
  animationTime = null;
  syncPlayback();
  draw();
  animationFrame = window.requestAnimationFrame(animationTick);
});
$('playback-progress').addEventListener('input', () => {
  const next = Number($('playback-progress').value) / 1000;
  stopAnimation(false);
  animationProgress = Math.max(0, Math.min(1, next));
  syncPlayback();
  draw();
});
for (const [id, p] of [
  ['playback-start', 0],
  ['playback-final', 1],
])
  $(id).addEventListener('click', () => {
    stopAnimation(false);
    animationProgress = p;
    syncPlayback();
    draw();
  });
$('playback-rate').addEventListener('change', () => {
  animationTime = null;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAnimation();
});

const status = (message, error = false, loading = false) => {
  const el = $('status');
  el.textContent = loading ? '' : message;
  el.classList.toggle('error', error);
  el.classList.toggle('loading', loading);
  el.ariaLabel = loading ? 'Calculating' : null;
  el.ariaBusy = String(loading);
};
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function cameraBasis(azimuth = yaw, elevation = pitch) {
  // World +Z is up. back points from target towards camera, not into screen.
  const back = [
    -Math.sin(azimuth) * Math.cos(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
  ];
  const rawRight = cross([0, 0, 1], back),
    length = Math.hypot(...rawRight);
  const right = rawRight.map((x) => x / length),
    up = cross(back, right);
  // right x up = back; this is a right-handed camera frame (determinant +1).
  return { right, up, back };
}
function modelFrame() {
  if (display?.bounds) {
    const [a, b] = display.bounds;
    return {
      center: a.map((v, i) => (v + b[i]) / 2),
      extent: Math.max(1, Math.hypot(...b.map((v, i) => v - a[i])) + display.cylinder.diameter),
    };
  }
  const c = display?.cylinder || { radius: 40, diameter: 4, height: 75 };
  return {
    center: [c.radius, c.type && c.type !== 'cylinder' ? 0 : c.radius, c.height / 2],
    extent: Math.hypot(
      2 * c.radius + c.diameter + (c.type === 's-curve' ? c.height / (2 * c.wind) : 0),
      c.height,
    ),
  };
}
function viewScale(w, h) {
  return Math.min(w / 130, h / 120) * zoom * (Math.hypot(84, 75) / modelFrame().extent);
}
function createProjector(w, h) {
  const center = modelFrame().center, basis = cameraBasis(), scale = viewScale(w, h);
  const cx = w / 2 + panX, cy = h / 2 + panY;
  return (point) => {
    const x = point[0] - center[0], y = point[1] - center[1], z = point[2] - center[2];
    const xx = x * basis.right[0] + y * basis.right[1] + z * basis.right[2];
    const zz = x * basis.up[0] + y * basis.up[1] + z * basis.up[2];
    const depth = -(x * basis.back[0] + y * basis.back[1] + z * basis.back[2]);
    return [cx + xx * scale, cy - zz * scale, depth];
  };
}
function project(point, w, h) {
  return createProjector(w, h)(point);
}
function draw() {
  syncCurrentOutput();
  if (viewDrawFrame !== null) {
    window.cancelAnimationFrame(viewDrawFrame);
    viewDrawFrame = null;
  }
  const rect = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const projectPoint = createProjector(rect.width, rect.height);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  // World-axis triad uses the same projection as the geometry, never mirrors data.
  const center = modelFrame().center,
    origin = projectPoint(center),
    anchor = [rect.width - 50, rect.height - 48];
  ctx.font = canvasFont(10);
  ctx.lineWidth = 1.5;
  for (const [point, label, color] of [
    [center.map((v, i) => v + (i === 0 ? 10 : 0)), 'X', '#ae5947'],
    [center.map((v, i) => v + (i === 1 ? 10 : 0)), 'Y', '#55815b'],
    [center.map((v, i) => v + (i === 2 ? 10 : 0)), 'Z', '#47778e'],
  ]) {
    const end = projectPoint(point),
      dx = end[0] - origin[0],
      dy = end[1] - origin[1];
    const scale = viewScale(rect.width, rect.height);
    const x = anchor[0] + (dx / scale) * 2.2,
      y = anchor[1] + (dy / scale) * 2.2;
    if (Math.hypot(x - anchor[0], y - anchor[1]) < 3) {
      ctx.fillStyle = color;
      ctx.fillText((end[2] < origin[2] ? '⊙ ' : '⊗ ') + label, anchor[0] - 12, anchor[1] + 17);
      continue;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(...anchor);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillText(label, x + 3, y - 3);
    const angle = Math.atan2(y - anchor[1], x - anchor[0]);
    ctx.beginPath();
    ctx.moveTo(x - 5 * Math.cos(angle - 0.45), y - 5 * Math.sin(angle - 0.45));
    ctx.lineTo(x, y);
    ctx.lineTo(x - 5 * Math.cos(angle + 0.45), y - 5 * Math.sin(angle + 0.45));
    ctx.stroke();
  }
  $('tube-webgl').hidden = renderMode !== 'render' || !display;
  if (!display) return;
  if (renderMode === 'render' && window.FluixerTubeRenderer) {
    try {
      tubeRenderer = tubeRenderer || new window.FluixerTubeRenderer($('tube-webgl'));
      tubeRenderer.draw(
        display,
        animatedSegments(display, animationProgress),
        Math.min(innerDiameter, display.cylinder.diameter * 0.999),
        modelFrame(),
        cameraBasis(),
        viewScale(rect.width, rect.height),
        [panX, panY],
        rect,
        ratio,
      );
    } catch (error) {
      $('tube-render-error').textContent = error.message;
    }
    drawPlane(rect);
    return;
  }
  const strokes = [];
  for (const segment of animatedSegments(display, animationProgress)) {
    for (let i = 1; i < segment.points.length; i++) {
      const a = projectPoint(segment.points[i - 1]),
        b = projectPoint(segment.points[i]);
      strokes.push({ a, b, depth: (a[2] + b[2]) / 2, phase: segment.phase });
    }
  }
  strokes.sort((a, b) => b.depth - a.depth);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const liquidColor = uiColor('accent-text', '#C2141C'), gasColor = uiColor('secondary', '#585A5A');
  for (const s of strokes) {
    const near = 1 - Math.max(0, Math.min(1, (s.depth + 50) / 100));
    ctx.globalAlpha = s.phase === 'liquid' ? 0.55 + near * 0.45 : 0.22 + near * 0.48;
    ctx.strokeStyle =
      s.phase === 'liquid' ? liquidColor : gasColor;
    ctx.lineWidth = (s.phase === 'liquid' ? 3.8 : 2.2) * Math.min(zoom, 1.6);
    ctx.beginPath();
    ctx.moveTo(s.a[0], s.a[1]);
    ctx.lineTo(s.b[0], s.b[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawPlane(rect);
}
function syncRenderControls() {
  $('view-lines').ariaPressed = String(renderMode === 'lines');
  $('view-render').ariaPressed = String(renderMode === 'render');
  const outer = Number($('tube-diameter').value) || 4;
  if (innerDiameter >= outer) innerDiameter = outer * 0.5;
  for (const id of ['tube-inner', 'tube-inner-slider']) {
    $(id).max = Math.max(0.01, outer - 0.01);
    $(id).value = innerDiameter;
  }
  syncSliderFill($('tube-inner-slider'));
}
for (const mode of ['lines', 'render'])
  $('view-' + mode).addEventListener('click', () => {
    renderMode = mode;
    syncRenderControls();
    draw();
  });
for (const id of ['tube-inner', 'tube-inner-slider'])
  $(id).addEventListener('input', () => {
    const value = Number($(id).value),
      outer = Number($('tube-diameter').value);
    if (!Number.isFinite(value) || value <= 0 || value >= outer) {
      $('tube-render-error').textContent =
        'Inner diameter must be positive and smaller than the outer diameter';
      return;
    }
    $('tube-render-error').textContent = '';
    innerDiameter = value;
    syncRenderControls();
    draw();
  });
const DEFAULT_TUBE = { radius: 40, diameter: 4, height: 75, wind: 16 };
let tubeStepSource = null,
  tubeStepReverse = false,
  tubeStepReadId = 0;
const tubeNames = ['radius', 'diameter', 'height', 'wind'];
function validateTube(c) {
  if (
    !c ||
    !tubeNames.every((n) => Object.hasOwn(c, n)) ||
    Object.keys(c).some(
      (n) =>
        ![
          ...tubeNames,
          'type',
          'mapping',
          'placement',
          'source',
          'reverse',
          'center',
          'initial_placement',
        ].includes(n),
    )
  )
    throw Error('Incomplete tube parameters');
  for (const [n, lo, hi] of [
    ['radius', 1, 500],
    ['diameter', 0.1, 100],
    ['height', 1, 1000],
    ['wind', 1, 64],
  ])
    if (typeof c[n] !== 'number' || !Number.isFinite(c[n]) || c[n] < lo || c[n] > hi)
      throw Error('Tube parameter out of range: ' + n);
  if (c.mapping !== undefined && c.mapping !== 'projection')
    throw Error('Invalid mapping method');
  if (c.type !== undefined && !['cylinder', 's-curve', 'hilbert', 'custom-step'].includes(c.type))
    throw Error('Invalid tube type');
  if (c.type === 'hilbert' && c.wind > 6) throw Error('Hilbert order must be between 1 and 6');
  if (
    c.type === 'custom-step' &&
    (typeof c.source !== 'string' ||
      !c.source ||
      c.source.length > 2097152 ||
      typeof c.reverse !== 'boolean')
  )
    throw Error('Choose a valid STEP centerline');
  if (
    c.center !== undefined &&
    (!Array.isArray(c.center) ||
      c.center.length !== 3 ||
      c.center.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6))
  )
    throw Error('Invalid tube center');
  if (!Number.isInteger(c.wind)) throw Error('Windings must be an integer');
  return c;
}
function selectedTube() {
  const c = {};
  for (const n of tubeNames) {
    if (String($('tube-' + n).value).trim() === '') throw Error('Complete all tube parameters');
    c[n] = Number($('tube-' + n).value);
  }
  if ($('tube-type').value !== 'cylinder') {
    c.type = $('tube-type').value;
    c.radius /= 2;
  }
  if ($('mapping-type').value !== 'projection') throw Error('Surface flow is not available yet');
  if (tubeCenter) c.center = tubeCenter.slice();
  if (placement) c.placement = clonePlane(placement);
  if (initialPlacement) c.initial_placement = clonePlane(initialPlacement);
  if (c.type === 'custom-step') {
    c.source = tubeStepSource;
    c.reverse = tubeStepReverse;
  }
  return validateTube(c);
}
function planeKey(p) {
  return p
    ? JSON.stringify([
        p.position,
        p.rotation,
        p.scale,
        p.direction,
        p.depth ?? null,
        p.size ?? null,
      ])
    : null;
}
function sameTube(a, b) {
  return (
    !!b &&
    JSON.stringify(a.center || null) === JSON.stringify(b.center || null) &&
    (a.source || null) === (b.source || null) &&
    !!a.reverse === !!b.reverse &&
    planeKey(a.placement) === planeKey(b.placement) &&
    (a.mapping || 'projection') === 'projection' &&
    (b.mapping || 'projection') === 'projection' &&
    (a.type || 'cylinder') === (b.type || 'cylinder') &&
    tubeNames.every((n) => a[n] === b[n])
  );
}
let tubeKind = 'cylinder';
function tubeLabels() {
  const calibrationAvailable = ['cylinder', 's-curve'].includes($('tube-type').value);
  $('tab-calibration').disabled = !calibrationAvailable;
  if (!calibrationAvailable && !$('panel-calibration').hidden) {
    selectSidebarTab('tube');
  }
  const isS = $('tube-type').value !== 'cylinder',
    isH = $('tube-type').value === 'hilbert';
  for (const id of ['tube-wind', 'tube-slider-wind']) $(id).max = isH ? 6 : 64;
  const custom = $('tube-type').value === 'custom-step';
  $('tube-step-fields').hidden = !custom;
  for (const n of ['radius', 'height', 'wind']) $('tube-' + n + '-field').hidden = custom;
  $('mapping-type').value = 'projection';
  $('mapping-type').disabled = projectBusy;
  $('tube-radius-label').textContent = isS ? 'Width (mm)' : 'Radius (mm)';
  $('tube-wind-label').textContent = isH ? 'Order' : isS ? 'Passes' : 'Windings';
  for (const id of ['tube-radius', 'tube-slider-radius']) {
    $(id).min = isS ? 2 : 1;
    $(id).max = isS ? 1000 : 500;
  }
  for (const n of tubeNames) syncSliderFill($('tube-slider-' + n));
}
function setTube(c) {
  tubeCenter = c.center ? c.center.slice() : null;
  if (c.type === 'custom-step') {
    tubeStepSource = c.source;
    tubeStepReverse = !!c.reverse;
    $('tube-step-reverse').ariaPressed = String(tubeStepReverse);
  }
  initialPlacement = clonePlane(c.initial_placement || defaultPlacement(c));
  placement = clonePlane(c.placement || initialPlacement);
  planeVisible = !!c.placement;
  $('plane-toggle').ariaPressed = String(planeVisible);
  $('mapping-type').value = 'projection';
  tubeKind = c.type || 'cylinder';
  $('tube-type').value = tubeKind;
  tubeLabels();
  for (const n of tubeNames) {
    const value = n === 'radius' && tubeKind !== 'cylinder' ? c[n] * 2 : c[n];
    $('tube-' + n).value = value;
    $('tube-slider-' + n).value = value;
  }
  tubeLabels();
  syncRenderControls();
}
$('mapping-type').addEventListener('change', loadDisplay);
$('tube-type').addEventListener('change', () => {
  spatialStroke = null;
  const next = $('tube-type').value;
  if (next !== tubeKind) {
    ++tubeStepReadId;
    planeDrag = null;
  }
  if (next !== tubeKind) tubeCenter = null;
  tubeLabels();
  if (next !== tubeKind) {
    const input = $('tube-radius'),
      v = Number(input.value);
    input.value = tubeKind === 'cylinder' ? v * 2 : next === 'cylinder' ? v / 2 : v;
    if (next === 'hilbert' || tubeKind === 'hilbert')
      for (const id of ['tube-wind', 'tube-slider-wind']) $(id).value = next === 'hilbert' ? 3 : 16;
    $('tube-slider-radius').value = input.value;
    tubeKind = next;
  }
  tubeLabels();
  loadDisplay();
});
function tubeAvailability() {
  syncRenderControls();
  $('mapping-type').disabled = projectBusy;
  for (const n of tubeNames)
    for (const prefix of ['tube-', 'tube-slider-'])
      $(prefix + n).disabled =
        projectBusy || ($('tube-type').value === 'custom-step' && n !== 'diameter');
}
setTube(DEFAULT_TUBE);
for (const n of tubeNames) {
  $('tube-' + n).addEventListener('input', () => {
    const v = Number($('tube-' + n).value);
    if (Number.isFinite(v) && $('tube-' + n).value !== '') {
      $('tube-slider-' + n).value = v;
      syncSliderFill($('tube-slider-' + n));
    }
  });
  $('tube-' + n).addEventListener('change', loadDisplay);
  $('tube-slider-' + n).addEventListener('input', () => {
    $('tube-' + n).value = $('tube-slider-' + n).value;
    syncSliderFill($('tube-slider-' + n));
    loadDisplay();
  });
  // Range input fires for dragging and keyboard edits; change would repeat the final request.
}
$('tube-reset').addEventListener('click', () => {
  const csvDiameter = importedCsv ? Number($('tube-diameter').value) : null;
  if (!importedCsv) innerDiameter = 2;
  const type = $('tube-type').value;
  if (type === 'custom-step') {
    tubeStepReverse = false;
    $('tube-step-reverse').ariaPressed = 'false';
    $('tube-diameter').value = csvDiameter ?? 4;
    $('tube-slider-diameter').value = csvDiameter ?? 4;
    loadDisplay();
    return;
  }
  const savedPlane = clonePlane(placement),
    savedInitial = clonePlane(initialPlacement),
    visible = planeVisible,
    center =
      tubeCenter ||
      (display?.bounds ? display.bounds[0].map((v, i) => (v + display.bounds[1][i]) / 2) : null);
  setTube({
    ...DEFAULT_TUBE,
    ...(csvDiameter !== null ? { diameter: csvDiameter } : {}),
    placement: savedPlane,
    initial_placement: savedInitial,
    ...(center ? { center } : {}),
    ...(type !== 'cylinder' ? { type } : {}),
    ...(type === 'hilbert' ? { wind: 3 } : {}),
  });
  planeVisible = visible;
  syncPlaneTools();
  loadDisplay();
});
$('tube-step-open').addEventListener('click', () => $('tube-step-file').click());
$('tube-step-reverse').addEventListener('click', () => {
  tubeStepReverse = !tubeStepReverse;
  $('tube-step-reverse').ariaPressed = String(tubeStepReverse);
  loadDisplay();
});
$('tube-step-file').addEventListener('change', async () => {
  const file = $('tube-step-file').files?.[0],
    id = ++tubeStepReadId;
  if (!file) return;
  $('tube-step-file').value = '';
  status('');
  try {
    if (!/\.(stp|step)$/i.test(file.name) || file.size > 2097152)
      throw Error('Choose an STP / STEP file up to 2 MB');
    const source = await file.text(),
      response = await fetch('/api/tube-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
      data = await response.json();
    if (!response.ok) throw Error(data.error || 'Centerline validation failed');
    if (id !== tubeStepReadId || $('tube-type').value !== 'custom-step') return;
    tubeStepSource = source;
    tubeStepReverse = false;
    tubeCenter = null;
    $('tube-step-reverse').ariaPressed = 'false';
    await loadDisplay();
  } catch (error) {
    if (id === tubeStepReadId && $('tube-type').value === 'custom-step') status(error.message, true);
  }
});
function validatePatternBounds(shape, tube = DEFAULT_TUBE) {
  tube = patternFrame(tube);
  if (
    !shape ||
    typeof shape !== 'object' ||
    Array.isArray(shape) ||
    Object.keys(shape).sort().join('|') !== 'height|width|x|z'
  )
    throw Error('Incomplete pattern bounds');
  for (const n of ['width', 'height', 'x', 'z'])
    if (typeof shape[n] !== 'number' || !Number.isFinite(shape[n]))
      throw Error('Pattern bounds must be finite numbers');
  if (
    shape.width <= 0 ||
    shape.height <= 0 ||
    shape.x < 0 ||
    shape.z < 0 ||
    shape.x + shape.width > 2 * tube.radius ||
    shape.z + shape.height > tube.height
  )
    throw Error('Pattern exceeds its frame bounds. Adjust its size or position');
  return shape;
}
function selectedPattern() {
  if ($('pattern-type').value === 'spatial-brush')
    return { type: 'spatial-brush', windows: spatialWindows.map((w) => w.slice()) };
  if ($('pattern-type').value === 'image')
    return imageActive ? validateImagePattern(imageActive, selectedTube()) : { type: 'empty' };
  if ($('pattern-type').value === 'brush') {
    if (!brushActive) {
      const tube = patternFrame(selectedTube()),
        side = Math.min(2 * tube.radius, tube.height) * 0.7;
      brushActive = {
        type: 'brush',
        source: brushSource(),
        width: side,
        height: side,
        x: (2 * tube.radius - side) / 2,
        z: (tube.height - side) / 2,
      };
    }
    return validateBrushPattern(brushActive, selectedTube());
  }
  if ($('pattern-type').value === 'step') {
    if (!stepActive) return { type: 'empty' };
    return validateStepPattern(stepActive, selectedTube());
  }
  return { type: 'captured-s' };
}
let imageActive = null,
  imageRaster = null,
  imagePhoto = null,
  imagePhotoPending = null,
  imagePhotoSource = null,
  imageReadId = 0,
  imageProcessId = 0;
function validateImagePattern(shape, tube) {
  if (!shape || shape.type !== 'image') throw Error('Invalid image pattern');
  validateBrushPattern({ ...shape, type: 'brush' }, tube);
  return shape;
}
function sameImage(a, b) {
  return !!b && b.type === 'image' && sameBrush({ ...a, type: 'brush' }, { ...b, type: 'brush' });
}
function paintImage() {
  const g = $('image-preview').getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = uiColor('accent-text', '#C2141C');
  if (imageActive) {
    const rows = JSON.parse(imageActive.source).rows;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) if (rows[y][x] === '1') g.fillRect(x, y, 1, 1);
  }
  for (const id of ['image-mode', 'image-threshold', 'image-invert'])
    $(id).disabled = !imageRaster || projectBusy;
}
function rasterImage(bitmap) {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height)),
    w = Math.max(1, Math.round(bitmap.width * scale)),
    h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return c.getContext('2d').getImageData(0, 0, w, h);
}
async function processImage() {
  if (!imageRaster) return;
  imageHistoryPending++;
  const id = ++imageProcessId,
    read = imageReadId,
    mode = $('image-mode').value;
  let raster = imageRaster;
  try {
    if (mode === 'photo') {
      $('image-status').textContent = 'Extracting subject…';
      if (!imagePhoto) {
        if (!imagePhotoPending) {
          const source = imagePhotoSource;
          imagePhotoPending = (async () => {
            const response = await fetch('/api/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source }),
              }),
              data = await response.json();
            if (!response.ok) throw Error(data.error || 'Subject extraction failed');
            const blob = await (await fetch('data:image/png;base64,' + data.png)).blob(),
              bitmap = await createImageBitmap(blob);
            const next = rasterImage(bitmap);
            bitmap.close();
            return next;
          })();
        }
        const pending = imagePhotoPending;
        try {
          const next = await pending;
          if (read !== imageReadId || id !== imageProcessId) return;
          imagePhoto = next;
        } finally {
          if (imagePhotoPending === pending && read === imageReadId) imagePhotoPending = null;
        }
      }
      raster = imagePhoto;
    }
    if (read !== imageReadId || id !== imageProcessId) return;
    const bits = window.FluixerImage.extract(raster.data, raster.width, raster.height, {
      mode,
      threshold: Number($('image-threshold').value),
      invert: $('image-invert').checked,
    });
    if (!bits.some((v) => v))
      throw Error('No subject detected. Adjust the threshold or extraction mode');
    const ox = Math.floor((256 - raster.width) / 2),
      oy = Math.floor((256 - raster.height) / 2),
      rows = Array.from({ length: 256 }, () => Array(256).fill('0'));
    for (let y = 0; y < raster.height; y++)
      for (let x = 0; x < raster.width; x++)
        rows[y + oy][x + ox] = String(bits[y * raster.width + x]);
    const frame = patternFrame(selectedTube()),
      side = Math.min(frame.radius * 2, frame.height) * 0.8;
    imageActive = {
      type: 'image',
      source: JSON.stringify({ size: 256, rows: rows.map((r) => r.join('')) }),
      width: side,
      height: side,
      x: (2 * frame.radius - side) / 2,
      z: (frame.height - side) / 2,
    };
    $('image-status').textContent = '';
    paintImage();
    if ($('pattern-type').value === 'image') loadDisplay();
  } catch (error) {
    if (read === imageReadId && id === imageProcessId)
      $('image-status').textContent = error.message;
  } finally {
    imageHistoryPending--;
    commitEditHistory();
  }
}
$('image-open').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', async () => {
  const file = $('image-file').files?.[0],
    id = ++imageReadId;
  ++imageProcessId;
  if (!file) return;
  $('image-file').value = '';
  try {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    )
      throw Error('Choose a PNG, JPEG or WebP image up to 10 MB');
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 24000000) {
      bitmap.close();
      throw Error('Images must not exceed 24 megapixels');
    }
    const raster = rasterImage(bitmap),
      c = document.createElement('canvas'),
      scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    c.width = Math.max(1, Math.round(bitmap.width * scale));
    c.height = Math.max(1, Math.round(bitmap.height * scale));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close();
    if (id !== imageReadId) return;
    imageRaster = raster;
    imagePhoto = null;
    imagePhotoPending = null;
    imagePhotoSource = c.toDataURL('image/png').split(',')[1];
    paintImage();
    await processImage();
  } catch (error) {
    if (id === imageReadId) $('image-status').textContent = error.message;
  }
});
for (const id of ['image-mode', 'image-invert']) $(id).addEventListener('change', processImage);
$('image-threshold').addEventListener('input', () => {
  syncSliderFill($('image-threshold'));
  processImage();
});
$('image-clear').addEventListener('click', () => {
  imageReadId++;
  imageProcessId++;
  imageActive = null;
  imageRaster = null;
  imagePhoto = null;
  imagePhotoPending = null;
  imagePhotoSource = null;
  $('image-status').textContent = '';
  paintImage();
  loadDisplay();
});
syncSliderFill($('image-threshold'));
let stepDraft = null,
  stepActive = null,
  stepReadId = 0,
  stepBusy = false;
const stepControlIds = ['step-open', 'step-apply'];
let stepPlacement = { width: 50, height: 50, x: 15, z: 12.5 };
function validateStepPattern(shape, tube = DEFAULT_TUBE) {
  if (
    !shape ||
    Object.keys(shape).sort().join('|') !== 'height|source|type|width|x|z' ||
    shape.type !== 'step' ||
    typeof shape.source !== 'string' ||
    shape.source.length > 2097152
  )
    throw Error('Invalid STEP project parameters');
  validatePatternBounds(
    { width: shape.width, height: shape.height, x: shape.x, z: shape.z },
    tube,
  );
  return shape;
}
function sameStep(a, b) {
  return (
    !!b &&
    b.type === 'step' &&
    a.source === b.source &&
    ['width', 'height', 'x', 'z'].every((n) => a[n] === b[n])
  );
}
function uncompensatedPreviewCurve() {
  return { amplitude: 0, x: [0, 1 / 3, 2 / 3, 1], y: [0, 0, 0, 0] };
}
function previewCurveFor(curve, tube) {
  return compensatedPreview && ['cylinder', 's-curve'].includes(tube.type || 'cylinder')
    ? curve : uncompensatedPreviewCurve();
}
function fetchDisplay(shape, tube, curve = uncompensatedPreviewCurve()) {
  if (
    tube.type === 'custom-step' ||
    ['step', 'brush', 'image', 'empty', 'spatial-brush'].includes(shape.type)
  )
    return fetch('/api/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: shape,
        compensation: curve,
        cylinder: tube,
      }),
    });
  return fetch(displayURL(curve, tube));
}
function clearStepResult() {
  if ($('pattern-type').value !== 'step') return;
  stepActive = null;
  stopAnimation();
  loadDisplay();
}
function stepDimensions() {
  return { ...stepPlacement };
}
function drawStepDraft() {
  const canvas = $('step-preview'),
    rect = canvas.getBoundingClientRect();
  const width = canvas.clientWidth || rect.width,
    height = canvas.clientHeight || rect.height;
  if (width <= 0 || height <= 0) return;
  const ratio = window.devicePixelRatio || 1,
    g = canvas.getContext('2d');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  g.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  g.clearRect(0, 0, width, height);
  if (!stepDraft) return;
  let d;
  try {
    d = stepDimensions();
  } catch {
    return;
  }
  if (!Number.isFinite(d.width) || !Number.isFinite(d.height) || d.width <= 0 || d.height <= 0)
    return;
  const scale = Math.min(Math.max(1, width - 44) / d.width, Math.max(1, height - 50) / d.height),
    w = d.width * scale,
    h = d.height * scale,
    ox = (width - w) / 2,
    oy = (height - 26 - h) / 2;
  g.strokeStyle = uiColor('line-2', '#CFCFCF');
  g.lineWidth = 1;
  g.strokeRect(ox, oy, w, h);
  g.fillStyle = uiColor('accent-text', '#C2141C');
  for (const [rule, rings] of stepDraft.parsed.groups) {
    g.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const x = ox + p[0] * w,
          y = oy + (1 - p[1]) * h;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
    }
    g.fill(rule);
  }
  g.fillStyle = uiColor('secondary', '#585A5A');
  g.font = canvasFont(11);
  g.fillText('X →   Z ↑', 12, height - 8);
  g.textAlign = 'right';
  g.fillText(d.width.toFixed(2) + ' × ' + d.height.toFixed(2) + ' mm', width - 12, height - 8);
  g.textAlign = 'left';
}
new ResizeObserver(drawStepDraft).observe($('step-preview'));
$('step-open').addEventListener('click', () => {
  if (!stepBusy && !projectBusy) $('step-file').click();
});
$('step-file').addEventListener('change', async () => {
  const file = $('step-file').files[0];
  $('step-file').value = '';
  if (!file || projectBusy) return;
  const token = ++stepReadId;
  stepBusy = true;
  stepDraft = null;
  clearStepResult();
  $('step-apply').disabled = true;
  $('step-open').disabled = true;
  drawStepDraft();
  $('step-status').textContent = 'Checking STEP…';
  try {
    if (!/\.(stp|step)$/i.test(file.name) || file.size > 2097152)
      throw Error('Choose a STEP file up to 2 MB');
    const source = await file.text();
    const response = await fetch('/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      }),
      data = await response.json();
    if (!response.ok) throw Error(data.error || 'STEP validation failed');
    if (token !== stepReadId) return;
    stepDraft = { source, parsed: data };
    const tube = patternFrame(selectedTube()),
      ratio = data.view_box[2] / data.view_box[3];
    let width = 2 * tube.radius * 0.7,
      height = width / ratio;
    if (height > tube.height * 0.7) {
      height = tube.height * 0.7;
      width = height * ratio;
    }
    stepPlacement = {
      width,
      height,
      x: (2 * tube.radius - width) / 2,
      z: (tube.height - height) / 2,
    };
    drawStepDraft();
    $('step-apply').disabled = false;
    $('step-status').textContent = 'Validated · ' + data.ring_count + ' contours';
  } catch (e) {
    if (token === stepReadId) $('step-status').textContent = 'Import failed: ' + e.message;
  } finally {
    if (token === stepReadId) {
      stepBusy = false;
      $('step-open').disabled = projectBusy;
    }
  }
});
$('step-apply').addEventListener('click', () => {
  if (!stepDraft || stepBusy || projectBusy) return;
  try {
    stepActive = validateStepPattern(
      { type: 'step', source: stepDraft.source, ...stepDimensions() },
      selectedTube(),
    );
    $('step-status').textContent = 'STEP confirmed. Generating tube segments…';
    loadDisplay();
  } catch (e) {
    $('step-status').textContent = 'Could not apply: ' + e.message;
  }
});
const DEFAULT_CURVE = { amplitude: 40, x: [0, 1 / 3, 2 / 3, 1], y: [0, 0, 0, 0] };
$('brush-size').addEventListener('input', () => syncSliderFill($('brush-size')));
syncSliderFill($('brush-size'));
const BRUSH_SIZE = 256,
  brushControls = ['brush-pen', 'brush-eraser', 'brush-size', 'brush-undo', 'brush-clear'];
let brushPixels = new Uint8Array(BRUSH_SIZE * BRUSH_SIZE),
  brushActive = null,
  brushStroke = null,
  brushErase = false;
const brushCanvas = $('brush-canvas');
function validateBrushPattern(shape, tube) {
  if (
    !shape ||
    Object.keys(shape).sort().join('|') !== 'height|source|type|width|x|z' ||
    shape.type !== 'brush' ||
    typeof shape.source !== 'string' ||
    shape.source.length > 70000
  )
    throw Error('Invalid brush parameters');
  const data = JSON.parse(shape.source);
  if (
    !data ||
    Object.keys(data).sort().join('|') !== 'rows|size' ||
    data.size !== 256 ||
    !Array.isArray(data.rows) ||
    data.rows.length !== 256 ||
    data.rows.some((r) => typeof r !== 'string' || !/^[01]{256}$/.test(r))
  )
    throw Error('Brush canvas is invalid or empty');
  validatePatternBounds(
    { width: shape.width, height: shape.height, x: shape.x, z: shape.z },
    tube,
  );
  return shape;
}
function sameBrush(a, b) {
  return (
    !!b &&
    b.type === 'brush' &&
    a.source === b.source &&
    ['width', 'height', 'x', 'z'].every((n) => a[n] === b[n])
  );
}
function brushSource() {
  return JSON.stringify({
    size: 256,
    rows: Array.from({ length: 256 }, (_, y) =>
      Array.from(brushPixels.slice(y * 256, (y + 1) * 256)).join(''),
    ),
  });
}
function paintBrush() {
  const g = brushCanvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = uiColor('accent-text', '#C2141C');
  for (let y = 0; y < 256; y++) {
    let start = -1;
    for (let x = 0; x <= 256; x++) {
      const on = x < 256 && brushPixels[y * 256 + x];
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        g.fillRect(start, y, x - start, 1);
        start = -1;
      }
    }
  }
  syncHistoryButtons();
}
function updateBrushPreview() {
  if (projectBusy || $('pattern-type').value !== 'brush') return;
  $('brush-status').textContent = '';
  try {
    const tube = patternFrame(selectedTube()),
      side = Math.min(2 * tube.radius, tube.height) * 0.7;
    const placement = brushActive || {
      width: side,
      height: side,
      x: (2 * tube.radius - side) / 2,
      z: (tube.height - side) / 2,
    };
    brushActive = validateBrushPattern(
      {
        type: 'brush',
        source: brushSource(),
        width: placement.width,
        height: placement.height,
        x: placement.x,
        z: placement.z,
      },
      tube,
    );
    loadDisplay();
  } catch (e) {
    ++requestId;
    previewQueued = false;
    display = null;
    draw();
    setExportDisabled(true);
    $('project-save').disabled = true;
    $('brush-status').textContent = e.message;
  }
}
function brushPoint(e) {
  const r = brushCanvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(256, ((e.clientX - r.left) / r.width) * 256)),
    Math.max(0, Math.min(256, ((e.clientY - r.top) / r.height) * 256)),
  ];
}
function brushLine(a, b, radius, erase) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  for (
    let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius));
    y < Math.min(256, Math.ceil(Math.max(a[1], b[1]) + radius));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius));
      x < Math.min(256, Math.ceil(Math.max(a[0], b[0]) + radius));
      x++
    ) {
      const t = length
        ? Math.max(0, Math.min(1, ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / length))
        : 0;
      if ((x + 0.5 - a[0] - t * dx) ** 2 + (y + 0.5 - a[1] - t * dy) ** 2 <= radius * radius)
        brushPixels[y * 256 + x] = erase ? 0 : 1;
    }
}
function finishBrush(cancel = false, silent = false) {
  if (!brushStroke) return;
  const stroke = brushStroke;
  brushStroke = null;
  if (cancel) brushPixels = stroke.before;
  if (brushCanvas.hasPointerCapture(stroke.id)) brushCanvas.releasePointerCapture(stroke.id);
  paintBrush();
  if (!silent) updateBrushPreview();
}
brushCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.isPrimary === false || brushStroke || projectBusy || exporting) return;
  e.preventDefault();
  const point = brushPoint(e);
  brushStroke = {
    id: e.pointerId,
    before: brushPixels.slice(),
    point,
    radius: Math.max(1, Math.min(32, Number($('brush-size').value) / 2 || 8)),
    erase: brushErase,
  };
  brushCanvas.setPointerCapture(e.pointerId);
  brushLine(point, point, brushStroke.radius, brushStroke.erase);
  paintBrush();
  updateBrushPreview();
});
brushCanvas.addEventListener('pointermove', (e) => {
  if (!brushStroke || e.pointerId !== brushStroke.id) return;
  if (e.buttons === 0) {
    finishBrush();
    return;
  }
  const point = brushPoint(e);
  brushLine(brushStroke.point, point, brushStroke.radius, brushStroke.erase);
  brushStroke.point = point;
  paintBrush();
  updateBrushPreview();
});
brushCanvas.addEventListener('pointerup', (e) => {
  if (brushStroke?.id === e.pointerId) {
    const point = brushPoint(e);
    brushLine(brushStroke.point, point, brushStroke.radius, brushStroke.erase);
    finishBrush();
  }
});
brushCanvas.addEventListener('pointercancel', () => finishBrush(true));
brushCanvas.addEventListener('lostpointercapture', () => finishBrush(true));
window.addEventListener('blur', () => finishBrush(true));
$('brush-pen').addEventListener('click', () => {
  brushErase = false;
  $('brush-pen').ariaPressed = 'true';
  $('brush-eraser').ariaPressed = 'false';
});
$('brush-eraser').addEventListener('click', () => {
  brushErase = true;
  $('brush-pen').ariaPressed = 'false';
  $('brush-eraser').ariaPressed = 'true';
});
$('brush-undo').addEventListener('click', () => moveEditHistory());
$('brush-clear').addEventListener('click', () => {
  if (projectBusy) return;
  finishBrush(true);
  if (brushPixels.some((v) => v)) {
    brushPixels.fill(0);
    paintBrush();
    updateBrushPreview();
  }
});
function restoreBrush(shape) {
  finishBrush(true, true);
  brushPixels = Uint8Array.from(JSON.parse(shape.source).rows.join(''), (v) => Number(v));

  brushActive = shape;
  paintBrush();
  $('brush-status').textContent = '';
}

const curveIds = ['curve-amplitude'];
let curveState = JSON.parse(JSON.stringify(DEFAULT_CURVE)),
  selectedPoint = null;
function validateCurve(c) {
  if (
    !c ||
    !['amplitude|x|y', 'amplitude|interpolation|x|y'].includes(Object.keys(c).sort().join('|')) ||
    ('interpolation' in c && c.interpolation !== 'pchip') ||
    !Array.isArray(c.x) ||
    !Array.isArray(c.y) ||
    c.x.length < 2 ||
    c.x.length > (c.interpolation ? 256 : 12) ||
    c.y.length !== c.x.length
  )
    throw Error('Incomplete compensation curve parameters');
  if (
    typeof c.amplitude !== 'number' ||
    !Number.isFinite(c.amplitude) ||
    c.amplitude < -80 ||
    c.amplitude > 80
  )
    throw Error('Compensation amplitude must be within -80–80 mm');
  if (
    c.x.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) ||
    c.y.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < -1 || v > 1) ||
    c.x[0] !== 0 ||
    c.x[c.x.length - 1] !== 1 ||
    c.x.some((v, i) => i > 0 && (c.interpolation ? v <= c.x[i - 1] : v < c.x[i - 1]))
  )
    throw Error('X must be ordered within 0–1; Y must be within -1–1');
  return c;
}
function selectedCurve() {
  for (const id of curveIds)
    if (String($(id).value).trim() === '') throw Error('Complete all compensation parameters');
  return validateCurve({
    ...(curveState.interpolation ? { interpolation: curveState.interpolation } : {}),
    amplitude: Number($('curve-amplitude').value),
    x: [...curveState.x],
    y: [...curveState.y],
  });
}
function setCurve(c) {
  curveState = JSON.parse(JSON.stringify(c));
  $('curve-amplitude').value = c.amplitude;
  if (selectedPoint >= c.x.length) selectedPoint = null;
  drawCurve(c);
}
function bezierCoordinate(values, t) {
  let v = [...values];
  while (v.length > 1) v = v.slice(0, -1).map((a, i) => (1 - t) * a + t * v[i + 1]);
  return v[0];
}

function drawCurve(c) {
  const canvas = $('curve-preview'),
    g = canvas.getContext('2d'),
    w = 280,
    h = 280;
  const side = Math.max(
    1,
    Math.round(
      (canvas.clientWidth || canvas.getBoundingClientRect().width || 280) *
        (window.devicePixelRatio || 1),
    ),
  );
  canvas.width = side;
  canvas.height = side;
  g.setTransform(side / 280, 0, 0, side / 280, 0, 0);
  g.clearRect(0, 0, w, h);
  // Rotate only the editor view; compensation values stay unchanged.
  g.translate(w, 0);
  g.rotate(Math.PI / 2);
  g.lineWidth = 1;
  g.strokeStyle = uiColor('line', '#E2E2E2');
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(24 + i * 60, 16);
    g.lineTo(24 + i * 60, 256);
    g.moveTo(24, 16 + i * 60);
    g.lineTo(264, 16 + i * 60);
    g.stroke();
  }
  g.strokeStyle = uiColor('secondary', '#585A5A');
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(24, 136);
  g.lineTo(264, 136);
  g.stroke();
  const px = (x) => 24 + 240 * x,
    py = (y) => 136 - 120 * y;
  g.strokeStyle = uiColor('muted', '#9A9A9A');
  g.beginPath();
  g.moveTo(px(c.x[0]), py(c.y[0]));
  for (let i = 1; i < c.x.length; i++) g.lineTo(px(c.x[i]), py(c.y[i]));
  g.stroke();
  g.strokeStyle = uiColor('accent-text', '#C2141C');
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px(c.x[0]), py(c.y[0]));
  for (let j = 1; j <= 256; j++) {
    const u = j / 256;
    g.lineTo(px(c.interpolation ? u : bezierCoordinate(c.x, u)),
      py(c.interpolation ? FluixerCalibration.interpolate(u, c.x, c.y) : bezierCoordinate(c.y, u)));
  }
  g.stroke();
  g.fillStyle = uiColor('primary', '#1C1C1C');
  g.font = canvasFont(10);
  for (let i = 0; i < c.x.length; i++) {
    g.beginPath();
    g.arc(px(c.x[i]), py(c.y[i]), i === selectedPoint ? 6 : 3, 0, Math.PI * 2);
    g.fill();
  }
  // Keep text upright while placing it beside the rotated geometry.
  g.setTransform(side / 280, 0, 0, side / 280, 0, 0);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  for (let i = 0; i < c.x.length; i++) {
    if (c.interpolation && i % Math.max(1, Math.ceil(c.x.length / 12)) && i !== c.x.length - 1) continue;
    const label = 'P' + i,
      x = w - py(c.y[i]),
      y = px(c.x[i]),
      textWidth = g.measureText(label).width;
    const labelX = x + 5 + textWidth <= w - 4 ? x + 5 : x - 5 - textWidth;
    g.fillText(label, Math.max(4, labelX), Math.max(12, y - 5));
  }
  g.textAlign = 'center';
  g.fillText('-1', 24, 16);
  g.fillText('0', 144, 16);
  g.fillText('+1', 264, 16);
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillText('0', 16, 24);
  g.fillText('1', 16, 264);
}
function sameCurve(a, b) {
  return (
    !!b &&
    a.interpolation === b.interpolation &&
    a.x.length === b.x?.length &&
    a.y.length === b.y?.length &&
    a.amplitude === b.amplitude &&
    a.x.every((v, i) => v === b.x?.[i]) &&
    a.y.every((v, i) => v === b.y?.[i])
  );
}
let curveDrag = null;
const curveCanvas = $('curve-preview');
function curvePosition(e) {
  const r = curveCanvas.getBoundingClientRect();
  const screenX = ((e.clientX - r.left) * 280) / r.width;
  const screenY = ((e.clientY - r.top) * 280) / r.height;
  // Invert the clockwise view rotation for dragging and click hit testing.
  return [screenY, 280 - screenX];
}
curveCanvas.addEventListener('pointerdown', (e) => {
  if (projectBusy || (importedCsv && !importedCsv.standard) || csvReading || curveDrag || e.altKey || !e.isPrimary || e.button !== 0) return;
  let c;
  try {
    c = selectedCurve();
  } catch {
    return;
  }
  const [x, y] = curvePosition(e);
  let best = -1,
    distance = 15;
  for (let i = 0; i < c.x.length; i++) {
    const d = Math.hypot(x - (24 + 240 * c.x[i]), y - (136 - 120 * c.y[i]));
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  if (best < 0) return;
  selectedPoint = best;
  drawCurve(c);
  e.preventDefault();
  curveCanvas.setPointerCapture(e.pointerId);
  curveDrag = { id: e.pointerId, index: best, original: c };
});
curveCanvas.addEventListener('pointermove', (e) => {
  if (!curveDrag || curveDrag.id !== e.pointerId) return;
  if (!(e.buttons & 1)) {
    finishCurveDrag(e, true);
    return;
  }
  const [x, y] = curvePosition(e),
    c = selectedCurve(),
    i = curveDrag.index;
  c.y[i] = Math.max(-1, Math.min(1, (136 - y) / 120));
  if (i > 0 && i < c.x.length - 1) {
    // Interpolated samples must remain strictly ordered, even when dragged onto a neighbor.
    const gap = c.interpolation ? Math.min(1e-6, (c.x[i + 1] - c.x[i - 1]) / 4) : 0;
    c.x[i] = Math.max(c.x[i - 1] + gap, Math.min(c.x[i + 1] - gap, (x - 24) / 240));
  }
  setCurve(c);
  loadDisplay();
});
function finishCurveDrag(e, cancel = false, silent = false) {
  if (!curveDrag || (e && e.pointerId !== curveDrag.id)) return;
  const d = curveDrag;
  curveDrag = null;
  if (cancel) setCurve(d.original);
  if (curveCanvas.hasPointerCapture(d.id)) curveCanvas.releasePointerCapture(d.id);
  if (!silent) loadDisplay();
}
curveCanvas.addEventListener('pointerup', (e) => finishCurveDrag(e));
for (const name of ['pointercancel', 'lostpointercapture'])
  curveCanvas.addEventListener(name, (e) => finishCurveDrag(e, true));
window.addEventListener('blur', () => finishCurveDrag(null, true));
new ResizeObserver(() => {
  try {
    drawCurve(selectedCurve());
  } catch {}
}).observe(curveCanvas);
setCurve(DEFAULT_CURVE);
for (const id of curveIds)
  $(id).addEventListener('change', () => {
    try {
      drawCurve(selectedCurve());
      $('curve-status').textContent = 'Updated';
    } catch (e) {
      $('curve-status').textContent = e.message;
    }
    loadDisplay();
  });
$('curve-reset').addEventListener('click', () => {
  selectedPoint = null;
  setCurve(DEFAULT_CURVE);
  loadDisplay();
});
curveCanvas.addEventListener('click', (e) => {
  if (projectBusy || (importedCsv && !importedCsv.standard) || csvReading || curveDrag || e.button !== 0) return;
  let c;
  try {
    c = selectedCurve();
  } catch {
    return;
  }
  const [x, y] = curvePosition(e);
  let best = -1,
    distance = 12;
  for (let i = 0; i < c.x.length; i++) {
    const d = Math.hypot(x - 24 - 240 * c.x[i], y - 136 + 120 * c.y[i]);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  if (e.altKey) {
    if (best <= 0 || best >= c.x.length - 1) return;
    c.x.splice(best, 1);
    c.y.splice(best, 1);
    selectedPoint = null;
  } else {
    if (best >= 0 || c.x.length >= (c.interpolation ? 256 : 12)) return;
    let point = null,
      nearest = 9;
    for (let j = 1; j < 400; j++) {
      const px = c.interpolation ? j / 400 : bezierCoordinate(c.x, j / 400),
        py = c.interpolation ? FluixerCalibration.interpolate(px, c.x, c.y) : bezierCoordinate(c.y, j / 400),
        d = Math.hypot(x - 24 - 240 * px, y - 136 + 120 * py);
      if (d < nearest) {
        nearest = d;
        point = [px, py];
      }
    }
    if (!point) return;
    const i = c.x.findIndex((v) => v > point[0]);
    if (i <= 0 || (c.interpolation && Math.min(point[0] - c.x[i - 1], c.x[i] - point[0]) < 1e-6)) return;
    c.x.splice(i, 0, point[0]);
    c.y.splice(i, 0, point[1]);
    selectedPoint = i;
  }
  e.preventDefault();
  setCurve(c);
  loadDisplay();
});
function displayURL(curve = DEFAULT_CURVE, tube = DEFAULT_TUBE) {
  const url = '/api/display?cylinder=' + encodeURIComponent(JSON.stringify(tube));
  return url + '&compensation=' + encodeURIComponent(JSON.stringify(curve));
}
function patternFrame(c = DEFAULT_TUBE) {
  return c.placement?.size
    ? { ...c, radius: c.placement.size[0] / 2, height: c.placement.size[1] }
    : c;
}
function followTubeResize() {
  let next;
  try {
    next = selectedTube();
  } catch {
    return;
  }
  if (
    !tubeCenter &&
    display?.bounds &&
    (next.type || 'cylinder') === (display.cylinder.type || 'cylinder') &&
    tubeNames.some((n) => next[n] !== display.cylinder[n])
  )
    tubeCenter = display.bounds[0].map((v, i) => (v + display.bounds[1][i]) / 2);
}
function loadDisplay() {
  if (csvReading) return;
  if (!editHistory?.restoring) followTubeResize();
  commitEditHistory();
  ++requestId;
  if (previewLoading) {
    previewQueued = true;
    return previewTask;
  }
  previewLoading = true;
  previewTask = renderDisplay(requestId).finally(() => {
    previewLoading = false;
    if (previewQueued) {
      previewQueued = false;
      loadDisplay();
    } else {
      syncPlayback();
      startCalibPreview();
    }
  });
  return previewTask;
}
async function renderDisplay(current) {
  // Keep the CSV sequence and current progress when changing its preview path.
  if (importedCsv) stopAnimation(false);
  else resetAnimation(false);
  tubeAvailability();
  $('spatial-fields').hidden = $('pattern-type').value !== 'spatial-brush';
  $('image-fields').hidden = $('pattern-type').value !== 'image';
  $('brush-fields').hidden = $('pattern-type').value !== 'brush';
  $('step-fields').hidden = $('pattern-type').value !== 'step';
  syncPlayback();
  draw();
  setExportDisabled(true);
  $('project-save').disabled = true;
  $('project-open').disabled = true;
  status('', false, true);
  $('export-status').textContent = '';
  for (const id of ['total', 'current-output-value', 'count']) $(id).textContent = '—';
  try {
    const requestedPattern = selectedPattern(),
      requestedCurve = selectedCurve(),
      requestedTube = selectedTube();
    const previewCurve = previewCurveFor(requestedCurve, requestedTube);
    const response = await fetchDisplay(requestedPattern, requestedTube, previewCurve);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Calculation failed');
    if (current !== requestId) return;
    if (requestedPattern.type === 'image' && !sameImage(requestedPattern, data.pattern_config))
      throw Error('Image result mismatch');
    if (requestedPattern.type === 'brush' && !sameBrush(requestedPattern, data.pattern_config))
      throw Error('Brush result mismatch');
    if (requestedPattern.type === 'step' && !sameStep(requestedPattern, data.pattern_config))
      throw Error('STEP result does not match the current pattern');
    if (!sameCurve(previewCurve, data.compensation))
      throw Error('Compensation parameter response mismatch. Restart the local server');
    if (!sameTube(requestedTube, data.cylinder || DEFAULT_TUBE))
      throw Error('Tube parameter response mismatch. Restart the server');
    if (
      requestedPattern.type === 'spatial-brush' &&
      JSON.stringify(requestedPattern) !== JSON.stringify(data.pattern_config)
    )
      throw Error('Spatial brush result mismatch');
    if (importedCsv?.standard) {
      const previous = importedCsv;
      const standard = await fetchStandardPattern(requestedCurve, requestedTube);
      if (importedCsv !== previous || current !== requestId) return;
      importedCsv = standardPreviewSequence(standard);
      $('calibration-standard-status').textContent = `${standard.count} liquid segments · 100 steps each`;
    }
    display = data;
    csvPreviewMetrics();
    const pending = current !== requestId;
    status('', false, pending);
    setExportDisabled(exporting || pending || requestedPattern.type === 'empty');
    $('project-save').disabled = pending;
    $('project-open').disabled = pending;
    syncPlayback();
    draw();
  } catch (error) {
    if (current === requestId) {
      if (importedCsv?.standard) clearCsvPreview();
      if (!placement) display = null;
      draw();
      status(error.message + '. Check the parameters or local server.', true);
      $('project-open').disabled = false;
    }
  }
}
$('pattern-type').addEventListener('change', () => {
  spatialStroke = null;
  canvas.style.cursor = $('pattern-type').value === 'spatial-brush' ? 'crosshair' : '';
  loadDisplay();
});
$('reset').addEventListener('click', () => {
  endDrag();
  yaw = -0.55;
  pitch = 0.25;
  zoom = 1;
  panX = 0;
  panY = 0;
  draw();
});
let dragging = null;
function endDrag(e) {
  if (!dragging || (e && e.pointerId !== dragging.id)) return;
  const id = dragging.id;
  dragging = null;
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerdown', (e) => {
  if (dragging || !e.isPrimary || e.button !== 2) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  if (!(e.buttons & 2) || !canvas.hasPointerCapture(e.pointerId)) {
    endDrag(e);
    return;
  }
  const dx = e.clientX - dragging.x,
    dy = e.clientY - dragging.y;
  if (e.shiftKey && !e.ctrlKey) {
    panX += dx;
    panY += dy;
  } else if (e.ctrlKey && !e.shiftKey) {
    zoom = Math.max(0.1, Math.min(10, zoom * Math.exp(-dy * 0.01)));
  } else {
    yaw += dx * 0.008;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.008));
  }
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  requestViewDraw();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(name, endDrag);
window.addEventListener('blur', () => endDrag());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) endDrag();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoom = Math.max(
      0.1,
      Math.min(
        10,
        zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 500 : 1) * 0.001),
      ),
    );
    requestViewDraw();
  },
  { passive: false },
);
canvas.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
    dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  if (e.shiftKey) {
    panX += dx * 20;
    panY += dy * 20;
  } else {
    yaw += dx * 0.1;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.1));
  }
  requestViewDraw();
});
new ResizeObserver(requestViewDraw).observe(canvas);
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

async function requestOutputCsv(compensated) {
    const data = {
      cylinder: display.cylinder || DEFAULT_TUBE,
      compensation: compensated ? selectedCurve() : uncompensatedPreviewCurve(),
      pattern: display.pattern_config || { type: 'captured-s' },
      pre_add: selectedPreAdd(),
      length_per_100_steps: selectedStepLength(),
      speed: Number($('speed').value),
      k_gas: Number($('k-gas').value),
      k_liquid: Number($('k-liquid').value),
      unit: $('unit').value,
    };
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw Error(error.error || 'Export failed');
    }
    return { response, data };
}

$('export-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!display || importedCsv || exporting || previewLoading) return;
  const compensated = event.submitter?.id !== 'export-original';
  exporting = true;
  setExportDisabled(true);
  try {
    $('export-status').textContent = 'Generating CSV…';
    const { response, data } = await requestOutputCsv(compensated);
    downloadBlob(await response.blob(), `fluixer_${compensated ? 'compensated' : 'original'}_${data.unit}.csv`);
    $('export-status').textContent =
      `Generated ${response.headers.get('X-Row-Count')} rows. Browser download requested (${data.unit}).`;
  } catch (error) {
    $('export-status').textContent = 'Export failed: ' + error.message;
  } finally {
    exporting = false;
    setExportDisabled(!display || previewLoading);
    startCalibPreview();
  }
});
const PROJECT_FORMAT = 'fluixer-project',
  PROJECT_SCHEMA_VERSION = 10;

function projectPatternPayload(pattern) {
  // A saved empty input retains its UI type; the solver only needs an empty region.
  return pattern.source === null ? { type: 'empty' } : pattern;
}

function validateProject(value) {
  const keys = (object, names) => {
    if (
      !object ||
      typeof object !== 'object' ||
      Array.isArray(object) ||
      Object.keys(object).sort().join('|') !== names.slice().sort().join('|')
    )
      throw Error('Project fields are incomplete or unsupported');
  };
  if (value?.format !== PROJECT_FORMAT || value?.schema_version !== PROJECT_SCHEMA_VERSION)
    throw Error('Unsupported project format or version. Only schema 10 is supported');
  keys(value, ['format', 'schema_version', 'pattern', 'compensation', 'cylinder', 'machine', 'view']);
  validateCurve(value.compensation);
  const tube = validateTube(value.cylinder);
  keys(tube, [
    ...tubeNames, 'type', 'mapping', 'placement', 'initial_placement',
    ...(Object.hasOwn(tube, 'center') ? ['center'] : []),
    ...(tube.type === 'custom-step' ? ['source', 'reverse'] : []),
  ]);
  if (!['cylinder', 's-curve', 'hilbert', 'custom-step'].includes(tube.type) ||
      tube.mapping !== 'projection')
    throw Error('Invalid project tube type or mapping');
  const vector = (v, length, min, max) =>
    Array.isArray(v) && v.length === length &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max);
  for (const name of ['placement', 'initial_placement']) {
    const p = tube[name];
    keys(p, ['position', 'rotation', 'scale', 'direction', 'depth', 'size']);
    if (!vector(p.position, 3, -10000, 10000) ||
        !vector(p.rotation, 3, -10000, 10000) ||
        !vector(p.scale, 3, 0.01, 100) ||
        !vector(p.direction, 3, -Number.MAX_VALUE, Number.MAX_VALUE) ||
        !Number.isFinite(Math.hypot(...p.direction)) || Math.hypot(...p.direction) < 1e-8 ||
        !vector(p.size, 2, Number.MIN_VALUE, 10000) ||
        !Number.isFinite(p.depth) || p.depth <= 0 || p.depth > 10000)
      throw Error('Invalid project projection parameters');
    const normal = rotatePlane([0, 1, 0], p.rotation);
    if (Math.abs(dot(normal, p.direction) / Math.hypot(...p.direction)) < 0.02)
      throw Error('Projection direction is nearly parallel to the pattern plane');
  }
  const pattern = value.pattern;
  switch (pattern?.type) {
    case 'captured-s':
      keys(pattern, ['type']);
      break;
    case 'step':
    case 'image':
      if (pattern.source === null) keys(pattern, ['type', 'source']);
      else if (pattern.type === 'step') validateStepPattern(pattern, tube);
      else validateImagePattern(pattern, tube);
      break;
    case 'brush':
      validateBrushPattern(pattern, tube);
      break;
    case 'spatial-brush':
      validateSpatialPattern(pattern);
      break;
    default:
      throw Error('Invalid project pattern type');
  }
  keys(value.machine, ['speed', 'k_gas', 'k_liquid', 'unit', 'pre_add', 'length_per_100_steps']);
  if (!Number.isFinite(value.machine.length_per_100_steps) || value.machine.length_per_100_steps <= 0)
    throw Error('100 Steps Length must be a positive number in mm');
  if (!Number.isFinite(value.machine.pre_add) || value.machine.pre_add < 0 || value.machine.pre_add > 10000)
    throw Error('Pre-Add must be between 0 and 10000 mm');
  for (const key of ['speed', 'k_gas', 'k_liquid']) {
    if (!Number.isSafeInteger(value.machine[key]) || value.machine[key] < 0)
      throw Error('Project speed and k parameters must be nonnegative integers');
  }
  if (!['steps', 'segments'].includes(value.machine.unit))
    throw Error('Invalid project output unit');
  keys(value.view, ['yaw', 'pitch', 'zoom', 'pan_x', 'pan_y', 'render', 'plane_visible']);
  if (typeof value.view.plane_visible !== 'boolean')
    throw Error('Invalid pattern plane visibility setting');
  const render = value.view.render;
  keys(render, ['mode', 'inner']);
  if (!['lines', 'render'].includes(render.mode) ||
      !Number.isFinite(render.inner) || render.inner <= 0 || render.inner >= tube.diameter)
    throw Error('Invalid inner or outer tube diameter');
  const ranges = {
    yaw: [-Math.PI, Math.PI], pitch: [-1.4, 1.4], zoom: [0.1, 10],
    pan_x: [-1e6, 1e6], pan_y: [-1e6, 1e6],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = value.view[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw Error('Invalid project camera parameter: ' + key);
  }
  return JSON.parse(JSON.stringify(value));
}

function currentProject() {
  const rect = canvas.getBoundingClientRect();
  const shape = display.pattern_config;
  const tube = display.cylinder;
  return validateProject({
    format: PROJECT_FORMAT,
    schema_version: PROJECT_SCHEMA_VERSION,
    pattern: shape.type === 'empty' ? { type: $('pattern-type').value, source: null } : shape,
    compensation: selectedCurve(),
    cylinder: {
      ...tube,
      type: tube.type || 'cylinder',
      mapping: tube.mapping || 'projection',
    },
    machine: {
      pre_add: selectedPreAdd(),
      length_per_100_steps: selectedStepLength(),
      speed: Number($('speed').value),
      k_gas: Number($('k-gas').value),
      k_liquid: Number($('k-liquid').value),
      unit: $('unit').value,
    },
    view: {
      plane_visible: planeVisible,
      render: { mode: renderMode, inner: innerDiameter },
      yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      pitch, zoom,
      pan_x: panX / rect.width,
      pan_y: panY / rect.height,
    },
  });
}

function restoreProject(project, data) {
  // Commit only after both project validation and geometry calculation succeed.
  const pattern = projectPatternPayload(project.pattern);
  if (pattern.type === 'empty' && data.pattern_config?.type !== 'empty')
    throw Error('Empty pattern result mismatch');
  if (pattern.type === 'image' && !sameImage(project.pattern, data.pattern_config))
    throw Error('Image result mismatch');
  if (pattern.type === 'brush' && !sameBrush(project.pattern, data.pattern_config))
    throw Error('Brush result mismatch');
  if (pattern.type === 'step' && !sameStep(project.pattern, data.pattern_config))
    throw Error('STEP result mismatch');
  if (!sameCurve(previewCurveFor(project.compensation, project.cylinder), data.compensation))
    throw Error('Compensation parameter response mismatch');
  if (!sameTube(project.cylinder, data.cylinder || DEFAULT_TUBE))
    throw Error('Tube parameter response mismatch');
  if (
    project.pattern?.type === 'spatial-brush' &&
    JSON.stringify(project.pattern) !== JSON.stringify(data.pattern_config)
  )
    throw Error('Spatial brush result mismatch');
  if (importedCsv || csvReading) clearCsvPreview();
  setTube(project.cylinder);
  setCurve(project.compensation);
  endDrag();
  display = data;
  resetAnimation();
  const shape = project.pattern;
  $('pattern-type').value = shape.type;
  $('spatial-fields').hidden = shape.type !== 'spatial-brush';
  if (shape.type === 'spatial-brush') {
    spatialWindows = shape.windows.map((w) => w.slice());

  }
  tubeAvailability();
  $('image-fields').hidden = shape.type !== 'image';
  if (shape.type === 'image') {
    imageReadId++;
    imageProcessId++;
    imageRaster = null;
    imagePhoto = null;
    imagePhotoPending = null;
    imagePhotoSource = null;
    imageActive = shape.source === null ? null : shape;
    paintImage();
  }
  $('brush-fields').hidden = shape.type !== 'brush';
  if (shape.type === 'brush') restoreBrush(shape);
  $('step-fields').hidden = shape.type !== 'step';
  if (shape.type === 'step') {
    stepActive = shape.source === null ? null : shape;
    stepDraft = null;
    stepPlacement = stepActive
      ? Object.fromEntries(['width', 'height', 'x', 'z'].map((n) => [n, shape[n]]))
      : null;
    $('step-status').textContent = stepActive ? 'Project STEP validated and restored.' : '';
    $('step-apply').disabled = true;
  }
  setPreAdd(project.machine.pre_add);
  $('length-per-100-steps').value = project.machine.length_per_100_steps;
  $('speed').value = project.machine.speed;
  $('k-gas').value = project.machine.k_gas;
  $('k-liquid').value = project.machine.k_liquid;
  $('unit').value = project.machine.unit;
  const rect = canvas.getBoundingClientRect();
  planeVisible = project.view.plane_visible;
  syncPlaneTools();
  yaw = project.view.yaw;
  pitch = project.view.pitch;
  zoom = project.view.zoom;
  renderMode = project.view.render.mode;
  innerDiameter = project.view.render.inner;
  syncRenderControls();
  panX = project.view.pan_x * rect.width;
  panY = project.view.pan_y * rect.height;
  $('total').textContent = data.path_length.toFixed(2) + ' mm';
  syncCurrentOutput();
  $('count').textContent = data.segments.length;
  $('export-status').textContent = '';
  status('');
  draw();
}
$('project-save').addEventListener('click', () => {
  if (importedCsv) return;
  if (!display || projectBusy || previewLoading) return;
  try {
    if (!$('export-form').reportValidity()) return;
    const project = currentProject(),
      blob = new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' });
    downloadBlob(blob, 'Fluixer-project.fluixer');
    $('project-status').textContent = 'Project saved';
  } catch (error) {
    $('project-status').textContent = 'Save failed: ' + error.message;
  }
});
$('project-open').addEventListener('click', () => {
  if (!projectBusy && !exporting) $('project-file').click();
});
$('project-file').addEventListener('change', async () => {
  const file = $('project-file').files[0];
  $('project-file').value = '';
  if (!file || projectBusy || exporting) return;
  stopAnimation();
  finishBrush(true, true);
  finishCurveDrag(null, true, true);
  projectBusy = true;
  ++stepReadId;
  stepBusy = false;
  syncPlayback();
  const previousDisplay = display;
  ++requestId;
  endDrag();
  const controls = [
    'image-open',
    'image-mode',
    'image-threshold',
    'image-invert',
    'image-clear',
    'mapping-type',
    'tube-type',
    ...brushControls,
    ...stepControlIds,
    ...tubeNames.flatMap((n) => ['tube-' + n, 'tube-slider-' + n]),
    'tube-reset',
    ...curveIds,
    'curve-reset',
    'project-open',
    'project-save',
    'export',
    'export-original',
    'pre-add',
    'length-per-100-steps',
    'speed',
    'k-gas',
    'k-liquid',
    'unit',
    'pattern-type',
  ];
  for (const id of controls) $(id).disabled = true;
  $('project-status').textContent = 'Opening project…';
  try {
    if (file.size > 4194304) throw Error('Project file exceeds the 4 MB limit');
    const project = validateProject(
      JSON.parse((await file.text()).replace(/^\uFEFF/, '')),
    );
    let parsedStep = null;
    if (project.pattern.type === 'step' && project.pattern.source !== null) {
      const check = await fetch('/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: project.pattern.source }),
      });
      parsedStep = await check.json();
      if (!check.ok) throw Error(parsedStep.error || 'STEP validation failed');
    }
    const response = await fetchDisplay(
        projectPatternPayload(project.pattern),
        project.cylinder,
        previewCurveFor(project.compensation, project.cylinder),
      ),
      data = await response.json();
    if (!response.ok) throw Error(data.error || 'Project calculation failed');
    restoreProject(project, data);
    editHistory?.reset();
    if (parsedStep) {
      stepDraft = { source: project.pattern.source, parsed: parsedStep };
      drawStepDraft();
    }
    $('project-status').textContent = 'Opened: ' + file.name;
  } catch (error) {
    display = previousDisplay;
    $('project-status').textContent =
      'Open failed; previous configuration retained: ' + error.message;
  } finally {
    projectBusy = false;
    syncPlayback();
    for (const id of controls) $(id).disabled = false;
    syncCsvControls();
    tubeAvailability();
    paintBrush();
    $('step-apply').disabled = !stepDraft;
    setExportDisabled(!display || exporting || display.pattern_config.type === 'empty');
    $('project-save').disabled = !display;
    startCalibPreview();
  }
});

function rotatePlane(p, r) {
  let [x, y, z] = p;
  r.forEach((a, i) => {
    const c = Math.cos((a * Math.PI) / 180),
      s = Math.sin((a * Math.PI) / 180);
    if (i === 0) [y, z] = [y * c - z * s, y * s + z * c];
    else if (i === 1) [x, z] = [x * c + z * s, -x * s + z * c];
    else [x, y] = [x * c - y * s, x * s + y * c];
  });
  return [x, y, z];
}
function followPlaneDirection(direction, oldRotation, newRotation) {
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((axis) => rotatePlane(axis, oldRotation));
  const local = axes.map((axis) => dot(direction, axis));
  const next = rotatePlane(local, newRotation),
    length = Math.hypot(...next);
  return next.map((v) => v / length);
}
function planePoint(x, z) {
  const c = patternFrame(display.cylinder),
    p = planeDrag ? placement : display.cylinder?.placement || placement;
  return rotatePlane(
    [(x - c.radius) * p.scale[0], 0, (z - c.height / 2) * p.scale[2]],
    p.rotation,
  ).map((v, i) => v + p.position[i]);
}
function clonePlane(p) {
  return JSON.parse(JSON.stringify(p));
}
function defaultPlacement(c = selectedTube(), bounds = null) {
  const planar = c.type && c.type !== 'cylinder' && c.type !== 'custom-step';
  const center =
    c.center ||
    (bounds
      ? bounds[0].map((v, i) => (v + bounds[1][i]) / 2)
      : [c.radius, planar ? 0 : c.radius, c.height / 2]);
  const front = bounds ? bounds[0][1] : planar ? center[1] : center[1] - c.radius - c.diameter / 2;
  const y = front - 20;
  return {
    size: [2 * c.radius, c.height],
    position: [center[0], y, center[2]],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    direction: [0, 1, 0],
    depth: Math.min(10000, center[1] - y + (planar ? 0.001 : 0)),
  };
}
function rotationDragStep(h, x, y) {
  const u = h.rotateU,
    v = h.rotateV,
    det = u[0] * v[1] - u[1] * v[0];
  let delta = 0;
  if (Math.abs(det) > 0.04 * Math.hypot(...u) * Math.hypot(...v)) {
    const angle = (px, py) => {
      const dx = px - h.origin[0],
        dy = py - h.origin[1];
      return Math.atan2((u[0] * dy - u[1] * dx) / det, (dx * v[1] - dy * v[0]) / det);
    };
    if (
      Math.hypot(x - h.origin[0], y - h.origin[1]) > 3 &&
      Math.hypot(h.lastX - h.origin[0], h.lastY - h.origin[1]) > 3
    ) {
      const d = angle(x, y) - angle(h.lastX, h.lastY);
      delta = Math.atan2(Math.sin(d), Math.cos(d));
    }
  } else {
    // Edge-on rings have no invertible screen ellipse. Use the picked side's tangent.
    const tx = -u[0] * Math.sin(h.angle) + v[0] * Math.cos(h.angle),
      ty = -u[1] * Math.sin(h.angle) + v[1] * Math.cos(h.angle),
      n = tx * tx + ty * ty;
    if (n > 4) delta = ((x - h.lastX) * tx + (y - h.lastY) * ty) / n;
  }
  h.lastX = x;
  h.lastY = y;
  h.turn = (h.turn || 0) + delta;
  return (h.turn * 180) / Math.PI;
}
function worldAxisRotation(rotation, axis, degrees, local = false) {
  const delta = [0, 0, 0];
  delta[axis] = degrees;
  const c = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((v) =>
    local
      ? rotatePlane(rotatePlane(v, delta), rotation)
      : rotatePlane(rotatePlane(v, rotation), delta),
  );
  const y = Math.asin(Math.max(-1, Math.min(1, -c[0][2]))),
    regular = Math.abs(Math.cos(y)) > 1e-7;
  return [
    ((regular ? Math.atan2(c[1][2], c[2][2]) : Math.atan2(-c[2][1], c[1][1])) * 180) / Math.PI,
    (y * 180) / Math.PI,
    ((regular ? Math.atan2(c[0][1], c[0][0]) : 0) * 180) / Math.PI,
  ];
}
function objectAxis(rotation, axis) {
  return rotatePlane(
    [0, 1, 2].map((i) => (i === axis ? 1 : 0)),
    rotation,
  );
}
function localAxisRotation(rotation, axis, degrees) {
  return worldAxisRotation(rotation, axis, degrees, true);
}
function depthFromDrag(depth, dx, dy, unit, travel, maxDepth) {
  if (travel < 1e-6) return depth;
  return Math.max(
    0.01,
    Math.min(
      10000,
      Math.min(maxDepth, depth + ((dx * unit[0] + dy * unit[1]) / travel) * maxDepth),
    ),
  );
}
function projectionArrowGeometry(p, screen) {
  const origin = screen(p.position),
    depth = p.depth || 160,
    n = Math.hypot(...p.direction);
  const end = screen(p.position.map((v, i) => v + (p.direction[i] / n) * depth)).slice(0, 2);
  const dx = end[0] - origin[0],
    dy = end[1] - origin[1],
    length = Math.hypot(dx, dy),
    unit = length > 1e-9 ? [dx / length, dy / length] : [0, -1];
  // The handle sits at 65% of the real arrow; its screen size stays constant.
  const knob = [origin[0] + dx * 0.65, origin[1] + dy * 0.65],
    maxDepth = 10000;
  return { end, unit, knob, maxDepth, travel: (length / depth) * 0.65 * maxDepth };
}
function activePlanePlacement() {
  return placement;
}
function drawPlane(rect) {
  if ($('pattern-type').value === 'spatial-brush') {
    planeHandles = [];
    return;
  }
  const placement = planeDrag
    ? activePlanePlacement()
    : display?.cylinder?.placement || activePlanePlacement();
  syncPlaneTools();
  planeHandles = [];
  if (!placement || !planeVisible || !display) return;
  const c = patternFrame(display.cylinder),
    screen = createProjector(rect.width, rect.height),
    corners = [
      [0, 0],
      [2 * c.radius, 0],
      [2 * c.radius, c.height],
      [0, c.height],
    ].map((p) => screen(planePoint(...p)));
  ctx.save();
  ctx.fillStyle = uiColor('secondary', '#585A5A');
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = uiColor('secondary', '#585A5A');
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = uiColor('accent-text', '#C2141C');
  for (const [x, z, a, b] of display.plane || []) {
    const p = screen(planePoint(x, z)),
      q = screen(planePoint(a, b));
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const origin = screen(placement.position),
    length = modelFrame().extent * 0.25,
    colors = ['#ae5947', '#55815b', '#47778e'];
  const mode = $('plane-tool').value;
  function handle(end, axis, kind, color) {
    ctx.fillStyle = color;
    const x = end[0],
      y = end[1];
    if (kind === 'scale') {
      ctx.fillRect(x - 5, y - 5, 10, 10);
    } else {
      const a = Math.atan2(y - origin[1], x - origin[0]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 13 * Math.cos(a - 0.4), y - 13 * Math.sin(a - 0.4));
      ctx.lineTo(x - 13 * Math.cos(a + 0.4), y - 13 * Math.sin(a + 0.4));
      ctx.closePath();
      ctx.fill();
    }
    planeHandles.push({ x, y, axis, origin: origin.slice(0, 2), mode: kind });
  }
  if (mode === 'direction') {
    const { end, unit, knob, travel, maxDepth } = projectionArrowGeometry(placement, screen),
      depth = placement.depth || 160;
    ctx.strokeStyle = uiColor('accent-text', '#C2141C');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(...origin.slice(0, 2));
    ctx.lineTo(...end);
    ctx.stroke();
    handle(end, 0, 'direction', ctx.strokeStyle);
    ctx.save();
    ctx.translate(...knob);
    ctx.rotate(Math.atan2(unit[1], unit[0]));
    ctx.fillStyle = uiColor('surface', '#FFFFFF');
    ctx.fillRect(-5, -9, 10, 18);
    ctx.strokeRect(-5, -9, 10, 18);
    ctx.restore();
    ctx.fillStyle = uiColor('primary', '#1C1C1C');
    ctx.fillText(depth.toFixed(1) + ' mm', knob[0] - unit[1] * 18, knob[1] + unit[0] * 18);
    planeHandles.push({
      x: knob[0],
      y: knob[1],
      axis: 0,
      origin: origin.slice(0, 2),
      mode: 'depth',
      unit,
      travel,
      maxDepth,
    });
  } else
    for (let i = 0; i < 3; i++) {
      const axis = objectAxis(placement.rotation, i),
        u = objectAxis(placement.rotation, (i + 1) % 3),
        v = objectAxis(placement.rotation, (i + 2) % 3);
      const offset = (axis, d) => placement.position.map((x, j) => x + axis[j] * d);
      const end = screen(offset(axis, length));
      ctx.strokeStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(...origin.slice(0, 2));
      ctx.lineTo(...end.slice(0, 2));
      ctx.stroke();
      handle(end, i, 'move', colors[i]);
      ctx.fillText('XYZ'[i], end[0] + 10, end[1]);
      handle(screen(offset(axis, length * 0.7)), i, 'scale', colors[i]);
      const rotateU = screen(offset(u, length * 0.48))
          .slice(0, 2)
          .map((v, j) => v - origin[j]),
        rotateV = screen(offset(v, length * 0.48))
          .slice(0, 2)
          .map((v, j) => v - origin[j]);
      ctx.beginPath();
      for (let k = 0; k <= 64; k++) {
        const angle = (k / 64) * Math.PI * 2,
          q = placement.position.map(
            (x, j) => x + length * 0.48 * (u[j] * Math.cos(angle) + v[j] * Math.sin(angle)),
          );
        const pt = screen(q);
        if (k) ctx.lineTo(pt[0], pt[1]);
        else ctx.moveTo(pt[0], pt[1]);
        if (k < 64)
          planeHandles.push({
            x: pt[0],
            y: pt[1],
            axis: i,
            origin: origin.slice(0, 2),
            mode: 'rotate',
            angle,
            rotateU,
            rotateV,
          });
      }
      ctx.stroke();
    }
  const depth = placement.depth;
  if (depth) {
    const n = Math.hypot(...placement.direction),
      offset = placement.direction.map((x) => (x / n) * depth),
      far = [
        [0, 0],
        [2 * c.radius, 0],
        [2 * c.radius, c.height],
        [0, c.height],
      ].map((p) => screen(planePoint(...p).map((v, i) => v + offset[i])));
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = uiColor('secondary', '#585A5A');
    ctx.beginPath();
    far.forEach((p, i) => {
      ctx.moveTo(...corners[i].slice(0, 2));
      ctx.lineTo(...p.slice(0, 2));
      ctx.lineTo(...far[(i + 1) % 4].slice(0, 2));
    });
    ctx.stroke();
  }
  ctx.restore();
}
function syncPlaneTools() {
  for (const [id, mode] of [
    ['tool-gumball', 'gumball'],
    ['tool-direction', 'direction'],
  ]) {
    $(id).ariaPressed = String(!!placement && planeVisible && $('plane-tool').value === mode);
    $(id).disabled = !placement || !planeVisible || projectBusy || !!importedCsv || csvReading;
  }
  $('plane-reset').disabled = projectBusy || !!importedCsv || csvReading;
  $('plane-toggle').ariaPressed = String(!!placement && planeVisible);
}
for (const [id, mode] of [
  ['tool-gumball', 'gumball'],
  ['tool-direction', 'direction'],
])
  $(id).addEventListener('click', () => {
    if (!placement || !planeVisible || projectBusy || importedCsv || csvReading) return;
    $('plane-tool').value = mode;
    syncPlaneTools();
    draw();
  });
$('plane-toggle').addEventListener('click', () => {
  planeVisible = !planeVisible;
  if (planeVisible) $('plane-tool').value = 'gumball';
  syncPlaneTools();
  draw();
});
$('plane-reset').addEventListener('click', () => {
  if (projectBusy || importedCsv || csvReading) return;
  placement = clonePlane(initialPlacement);
  loadDisplay();
});
$('plane-tool').addEventListener('change', draw);
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (
      $('pattern-type').value === 'spatial-brush' ||
      e.button !== 0 ||
      !placement ||
      !planeVisible ||
      importedCsv ||
      csvReading ||
      projectBusy
    )
      return;
    const r = canvas.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      h = planeHandles
        .map((h) => ({ h, d: Math.hypot(x - h.x, y - h.y) }))
        .filter((v) => v.d < 14)
        .sort((a, b) => a.d - b.d)[0]?.h;
    if (!h) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopAnimation();
    planeDrag = {
      ...h,
      id: e.pointerId,
      x,
      y,
      lastX: x,
      lastY: y,
      turn: 0,
      start: JSON.parse(JSON.stringify(placement)),
    };
    canvas.setPointerCapture(e.pointerId);
  },
  true,
);
canvas.addEventListener(
  'pointermove',
  (e) => {
    if (!planeDrag || planeDrag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = canvas.getBoundingClientRect(),
      h = planeDrag,
      dx = e.clientX - r.left - h.x,
      dy = e.clientY - r.top - h.y,
      p = JSON.parse(JSON.stringify(h.start));
    if (h.mode === 'depth') {
      p.depth = depthFromDrag(h.start.depth || 160, dx, dy, h.unit, h.travel, h.maxDepth);
    } else if (h.mode === 'direction') {
      const b = cameraBasis();
      p.direction = p.direction.map((v, i) => v + (dx * b.right[i] - dy * b.up[i]) / 80);
      const n = Math.hypot(...p.direction);
      if (n < 0.01) return;
      p.direction = p.direction.map((v) => v / n);
    } else if (h.mode === 'rotate') {
      const degrees = rotationDragStep(h, h.x + dx, h.y + dy);
      p.rotation = localAxisRotation(h.start.rotation, h.axis, degrees);
      p.direction = followPlaneDirection(h.start.direction, h.start.rotation, p.rotation);
    } else {
      const vx = h.x - h.origin[0],
        vy = h.y - h.origin[1],
        n = Math.hypot(vx, vy);
      if (n < 4) return;
      const delta = (dx * vx + dy * vy) / n;
      if (h.mode === 'move') {
        const axis = objectAxis(h.start.rotation, h.axis),
          distance = (delta * modelFrame().extent * 0.25) / n;
        p.position = p.position.map((v, i) => v + axis[i] * distance);
      } else {
        const factor = Math.max(0.01, Math.min(100, 1 + delta / 80));
        if (e.shiftKey) p.scale = p.scale.map((v) => Math.max(0.01, Math.min(100, v * factor)));
        else p.scale[h.axis] = Math.max(0.01, Math.min(100, p.scale[h.axis] * factor));
      }
    }
    placement = p;
    draw();
  },
  true,
);
function finishPlane(e) {
  if (!planeDrag || e.pointerId !== planeDrag.id) return;
  planeDrag = null;
  loadDisplay();
}
canvas.addEventListener('pointerup', finishPlane, true);
canvas.addEventListener('pointercancel', finishPlane, true);
loadDisplay();

function validateSpatialPattern(shape) {
  if (
    !shape ||
    shape.type !== 'spatial-brush' ||
    Object.keys(shape).sort().join('|') !== 'type|windows' ||
    !Array.isArray(shape.windows) ||
    shape.windows.length > 10000
  )
    throw Error('Invalid spatial brush data');
  let end = 0;
  for (const w of shape.windows) {
    if (
      !Array.isArray(w) ||
      w.length !== 2 ||
      !w.every(Number.isFinite) ||
      w[0] < end ||
      w[0] < 0 ||
      w[1] > 1 ||
      w[0] >= w[1]
    )
      throw Error('Invalid spatial brush intervals');
    end = w[1];
  }
  return shape;
}
function mergeSpatial(windows) {
  const result = [];
  for (const w of windows.sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && w[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], w[1]);
    else result.push(w.slice());
  }
  return result;
}
// A screen-space depth buffer: every pixel belongs only to its frontmost tube.
function spatialHitMap(data, rect, projection, scale) {
  const cell = 2,
    width = Math.ceil(rect.width / cell),
    height = Math.ceil(rect.height / cell);
  const depths = new Float64Array(width * height).fill(Infinity),
    hits = new Float64Array(width * height).fill(-1);
  const radius = Math.max(1.5, (data.cylinder.diameter * scale) / 2);
  let distance = 0;
  for (const segment of data.segments) {
    const points = segment.points,
      lengths = points.slice(1).map((p, i) => Math.hypot(...p.map((v, k) => v - points[i][k])));
    const total = lengths.reduce((a, b) => a + b, 0);
    let along = 0;
    for (let i = 0; i < lengths.length; i++) {
      const a = projection(points[i]),
        b = projection(points[i + 1]),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        sq = dx * dx + dy * dy;
      const minX = Math.max(0, Math.floor((Math.min(a[0], b[0]) - radius) / cell)),
        maxX = Math.min(width - 1, Math.ceil((Math.max(a[0], b[0]) + radius) / cell));
      const minY = Math.max(0, Math.floor((Math.min(a[1], b[1]) - radius) / cell)),
        maxY = Math.min(height - 1, Math.ceil((Math.max(a[1], b[1]) + radius) / cell));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const px = (x + 0.5) * cell,
            py = (y + 0.5) * cell,
            t = sq ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / sq)) : 0;
          const d2 = (px - a[0] - t * dx) ** 2 + (py - a[1] - t * dy) ** 2;
          if (d2 > radius * radius) continue;
          const depth = a[2] + (b[2] - a[2]) * t - Math.sqrt(radius * radius - d2) / scale,
            index = y * width + x;
          if (depth < depths[index]) {
            depths[index] = depth;
            hits[index] =
              (distance + (segment.length * (along + lengths[i] * t)) / (total || 1)) /
              data.path_length;
          }
        }
      along += lengths[i];
    }
    distance += segment.length;
  }
  return { cell, width, height, hits, pad: cell / scale / data.path_length };
}
function spatialStamp(x, y, stroke) {
  const { map, radius } = stroke,
    windows = [];
  for (
    let row = Math.max(0, Math.floor((y - radius) / map.cell));
    row <= Math.min(map.height - 1, Math.ceil((y + radius) / map.cell));
    row++
  )
    for (
      let col = Math.max(0, Math.floor((x - radius) / map.cell));
      col <= Math.min(map.width - 1, Math.ceil((x + radius) / map.cell));
      col++
    ) {
      if (Math.hypot((col + 0.5) * map.cell - x, (row + 0.5) * map.cell - y) > radius) continue;
      const u = map.hits[row * map.width + col];
      if (u >= 0) windows.push([Math.max(0, u - map.pad), Math.min(1, u + map.pad)]);
    }
  const marks = mergeSpatial(windows);
  if (spatialErase) {
    for (const [a, b] of marks)
      spatialWindows = spatialWindows.flatMap(([lo, hi]) =>
        hi <= a || lo >= b
          ? [[lo, hi]]
          : [...(lo < a ? [[lo, a]] : []), ...(hi > b ? [[b, hi]] : [])],
      );
  } else spatialWindows = mergeSpatial([...spatialWindows, ...marks]);
}
function syncSpatialControls() {
  $('spatial-pen').ariaPressed = String(!spatialErase);
  $('spatial-eraser').ariaPressed = String(spatialErase);
  for (const id of ['spatial-pen', 'spatial-eraser', 'spatial-size']) $(id).disabled = projectBusy;
  syncHistoryButtons();
  $('spatial-clear').disabled = projectBusy || !spatialWindows.length;
  syncSliderFill($('spatial-size'));
}
$('spatial-size').addEventListener('input', () => syncSliderFill($('spatial-size')));
syncSpatialControls();
$('spatial-pen').addEventListener('click', () => {
  spatialErase = false;
  $('spatial-pen').ariaPressed = 'true';
  $('spatial-eraser').ariaPressed = 'false';
});
$('spatial-eraser').addEventListener('click', () => {
  spatialErase = true;
  $('spatial-pen').ariaPressed = 'false';
  $('spatial-eraser').ariaPressed = 'true';
});
$('spatial-undo').addEventListener('click', () => moveEditHistory());
$('spatial-clear').addEventListener('click', () => {
  if (projectBusy || !spatialWindows.length) return;
  spatialWindows = [];
  loadDisplay();
});
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (
      e.button !== 0 ||
      $('pattern-type').value !== 'spatial-brush' ||
      importedCsv ||
      csvReading ||
      !display ||
      projectBusy ||
      previewLoading
    )
      return;
    e.preventDefault();
    stopAnimation();
    animationProgress = 1;
    const rect = canvas.getBoundingClientRect();
    spatialStroke = {
      id: e.pointerId,
      rect,
      radius: Number($('spatial-size').value) / 2,
      map: spatialHitMap(
        display,
        rect,
        (p) => project(p, rect.width, rect.height),
        viewScale(rect.width, rect.height),
      ),
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    canvas.setPointerCapture(e.pointerId);
    spatialStamp(spatialStroke.x, spatialStroke.y, spatialStroke);
    loadDisplay();
  },
  true,
);
canvas.addEventListener(
  'pointermove',
  (e) => {
    const stroke = spatialStroke;
    if (!stroke || stroke.id !== e.pointerId) return;
    if (!(e.buttons & 1)) {
      spatialStroke = null;
      return;
    }
    e.preventDefault();
    const x = e.clientX - stroke.rect.left,
      y = e.clientY - stroke.rect.top,
      n = Math.max(
        1,
        Math.ceil(Math.hypot(x - stroke.x, y - stroke.y) / Math.max(1, stroke.radius / 3)),
      );
    for (let i = 1; i <= n; i++)
      spatialStamp(
        stroke.x + ((x - stroke.x) * i) / n,
        stroke.y + ((y - stroke.y) * i) / n,
        stroke,
      );
    stroke.x = x;
    stroke.y = y;
    loadDisplay();
  },
  true,
);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(event, () => {
    spatialStroke = null;
  });

window.addEventListener('blur', () => {
  spatialStroke = null;
});

// Canvas text uses the same typography token as labels and numeric inputs.
function canvasFont(size) {
  const family =
    typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement).getPropertyValue('--f-mono').trim()
      : '';
  return `${size}px ${family || '"Geist Mono", "Microsoft YaHei", sans-serif'}`;
}
if (document.fonts) {
  Promise.all([document.fonts.load('10px "Geist Mono"'), document.fonts.ready]).then(() => {
    draw();
    drawCurve(curveState);
    if (stepDraft) drawStepDraft();
  });
}

const sidebarTabKeys = Array.from(document.querySelectorAll('.sidebar-tabs [role="tab"]'),
  (button) => button.id.slice('tab-'.length));

function selectSidebarTab(key, focus = false) {
  if ($('tab-' + key).disabled) return;
  const enteringCalib = key === 'calibration' && $('panel-calibration').hidden;
  const leavingCalib = key !== 'calibration' && !$('panel-calibration').hidden;
  for (const name of sidebarTabKeys) {
    const button = $('tab-' + name),
      active = name === key;
    button.ariaSelected = String(active);
    button.tabIndex = active ? 0 : -1;
    $('panel-' + name).hidden = !active;
    if (active && focus) button.focus();
  }
  if (leavingCalib) {
    calibPreviewPending = false;
    if (calibPreviewReading || importedCsv?.standard) {
      calibPreviewReading = false;
      clearCsvPreview();
      if (calibPreviousPreview) {
        importedCsv = calibPreviousPreview.sequence;
        animationProgress = calibPreviousPreview.progress;
        csvPreviewMetrics();
        syncPlayback();
      }
      draw();
    }
    calibPreviousPreview = null;
  }
  if (enteringCalib) {
    calibPreviousPreview = importedCsv ? { sequence: importedCsv, progress: animationProgress } : null;
    calibPreviewPending = true;
    startCalibPreview();
  }
  if (key === 'calibration') drawCurve(curveState);
  if (key === 'pattern') {
    paintBrush();
    if (stepDraft) drawStepDraft();
  }
}

for (const key of sidebarTabKeys) {
  const button = $('tab-' + key);
  button.addEventListener('click', () => selectSidebarTab(key));
  button.addEventListener('keydown', (event) => {
    const keys = sidebarTabKeys.filter((k) => !$('tab-' + k).hidden && !$('tab-' + k).disabled);
    const index = keys.indexOf(key);
    const next =
      event.key === 'ArrowRight'
        ? keys[(index + 1) % keys.length]
        : event.key === 'ArrowLeft'
          ? keys[(index + keys.length - 1) % keys.length]
          : event.key === 'Home'
            ? keys[0]
            : event.key === 'End'
              ? keys[keys.length - 1]
              : null;
    if (next) {
      event.preventDefault();
      selectSidebarTab(next, true);
    }
  });
}
selectSidebarTab('pattern');

function setExportDisabled(disabled) {
  $('export').disabled = disabled;
  $('export-original').disabled = disabled;
}
function syncCompensationPreview() {
  const standard = !!importedCsv?.standard;
  const supported = ['cylinder', 's-curve'].includes($('tube-type').value);
  $('view-compensated').setAttribute('aria-pressed', String(standard || (supported && compensatedPreview)));
  $('view-compensated').disabled = !supported || !!importedCsv || csvReading || projectBusy || exporting || previewLoading;
}
$('view-compensated').addEventListener('click', () => {
  if ($('view-compensated').disabled) return;
  compensatedPreview = !compensatedPreview;
  loadDisplay();
});

function syncCsvControls() {
  syncCompensationPreview();
  // A disabled fieldset preserves each control's own enabled/disabled state.
  // Inert also locks canvas editors and prevents keyboard focus while previewing.
  const locked = !!importedCsv || csvReading;
  for (const group of document.querySelectorAll('.csv-edit-controls')) {
    const editableCompensation = !!importedCsv?.standard && !!group.closest('#geometry-compensation, #calibration-dialog');
    group.disabled = locked && !editableCompensation;
    group.inert = group.disabled;
  }
  for (const group of document.querySelectorAll('.csv-tube-controls')) {
    group.disabled = projectBusy || csvReading || !!importedCsv?.standard;
    group.inert = group.disabled;
  }
  syncPlaneTools();
  const busy = projectBusy || previewLoading || exporting || csvReading;
  $('csv-import').disabled = !display || busy || !!importedCsv?.standard;
  const standard = !!importedCsv?.standard;
  const standardUnavailable = busy || !['cylinder', 's-curve'].includes($('tube-type').value) || (!!importedCsv && !standard);
  $('calibration-standard').disabled = standardUnavailable;
  $('csv-preview-clear').hidden = !importedCsv;
  $('csv-preview-clear').disabled = busy;
  $('csv-import').setAttribute('aria-pressed', String(!!importedCsv));
  if (importedCsv) {
    setExportDisabled(true);
    $('project-save').disabled = true;
  }
  window.FluixerSerial?.refresh?.();
}
function csvPreviewMetrics() {
  syncCurrentOutput();
  if (!display) return;
  $('total').textContent = display.path_length.toFixed(2) + ' mm';
  if (importedCsv) {
    const windows = csvPreviewWindows(importedCsv, display.path_length, 1);
    let count = 0, cursor = 0;
    for (const [a, b] of windows) { if (a > cursor) count++; count++; cursor = b; }
    if (cursor < display.path_length) count++;
    $('count').textContent = count;
  } else {
    $('count').textContent = display.segments.length;
  }
}
function clearCsvPreview() {
  ++csvReadId;
  csvReading = false;
  importedCsv = null;
  $('calibration-standard-status').textContent = '';
  $('csv-import-status').textContent = '';
  $('csv-import-status').removeAttribute('title');
  $('csv-import-status').hidden = true;
  resetAnimation();
  csvPreviewMetrics();
  setExportDisabled(!display || exporting || projectBusy || previewLoading || display.pattern_config?.type === 'empty');
  $('project-save').disabled = !display || projectBusy || previewLoading || display.pattern_config?.type === 'empty';
  syncCsvControls();
}
$('csv-import').addEventListener('click', () => {
  if (display && !projectBusy && !previewLoading && !exporting && !csvReading) $('csv-file').click();
});
$('csv-file').addEventListener('change', async () => {
  const file = $('csv-file').files[0];
  $('csv-file').value = '';
  if (!file || !display || projectBusy || previewLoading || exporting || csvReading) return;
  const token = ++csvReadId, sourceDisplay = display, sourceRequest = requestId;
  csvReading = true;
  syncCsvControls();
  $('csv-import-status').hidden = true;
  $('csv-import-status').textContent = 'Reading CSV…';
  try {
    if (file.size > 4194304) throw Error('CSV exceeds the 4 MB limit');
    const settings = { kGas: $('k-gas').value, kLiquid: $('k-liquid').value, preAdd: selectedPreAdd(), lengthPer100Steps: selectedStepLength() };
    const source = await file.text();
    if (token !== csvReadId || sourceDisplay !== display || sourceRequest !== requestId || projectBusy) return;
    const parsed = parsePreviewCsv(source, settings);
    stopAnimation();
    importedCsv = { ...parsed, serialSource: source };
    selectSidebarTab('output');
    animationProgress = 0;
    $('csv-import-status').textContent = file.name + (parsed.approximate ? ' · Approximate CSV Preview' : ' · CSV Preview');
    $('csv-import-status').title = `k_Gas: ${parsed.kGas}; k_Liquid: ${parsed.kLiquid}; 100 Steps Length: ${parsed.lengthPer100Steps} mm; Pre-Add excluded from preview: ${parsed.omittedPreAdd} mm. Normalized preview timing.`;
    $('export-status').textContent = '';
    csvPreviewMetrics();
    syncPlayback();
    draw();
  } catch (error) {
    if (token === csvReadId) {
      $('csv-import-status').hidden = false;
      $('csv-import-status').textContent = 'Import failed: ' + error.message;
    }
  } finally {
    if (token === csvReadId) {
      csvReading = false;
      syncPlayback();
      startCalibPreview();
    }
  }
});
$('csv-preview-clear').addEventListener('click', () => { clearCsvPreview(); draw(); });
syncCsvControls();


FluixerCalibration.init({
  locked: () => projectBusy || (!!importedCsv && !importedCsv.standard) || csvReading || !['cylinder', 's-curve'].includes($('tube-type').value),
  syncSlider: syncSliderFill,
  apply: (curve) => {
    finishCurveDrag(null, true, true);
    selectedPoint = null;
    setCurve(validateCurve(curve));
    selectSidebarTab('calibration');
    $('curve-status').textContent = '';
    loadDisplay();
  },
});


// STANDARD_PREVIEW_START
async function fetchStandardPattern(compensation = selectedCurve(), cylinder = selectedTube()) {
  const payload = {
    cylinder,
    compensation,
    speed: Number($('speed').value),
    k_gas: Number($('k-gas').value),
    pre_add: selectedPreAdd(),
    length_per_100_steps: selectedStepLength(),
  };
  const response = await fetch('/api/calibration-standard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error || 'Standard pattern failed');
  }
  return { source: await response.text(), count: Number(response.headers.get('X-Liquid-Count')), payload };
}

function standardPreviewSequence(standard) {
  return { ...parsePreviewCsv(standard.source, {
    kGas: standard.payload.k_gas, kLiquid: 625,
    preAdd: standard.payload.pre_add,
    lengthPer100Steps: standard.payload.length_per_100_steps,
  }), standard };
}

async function startCalibPreview() {
  if (!calibPreviewPending || $('panel-calibration').hidden || projectBusy || csvReading || exporting || previewLoading || !display) return;
  if (!['cylinder', 's-curve'].includes($('tube-type').value)) return;
  calibPreviewPending = false;
  calibPreviewReading = true;
  const token = ++csvReadId, sourceDisplay = display, sourceRequest = requestId;
  csvReading = true;
  $('calibration-standard-status').textContent = '';
  syncPlayback();
  try {
    const standard = await fetchStandardPattern();
    if (token !== csvReadId || $('panel-calibration').hidden || projectBusy) return;
    if (sourceDisplay !== display || sourceRequest !== requestId) {
      calibPreviewPending = true;
      return;
    }
    stopAnimation();
    importedCsv = standardPreviewSequence(standard);
    animationProgress = 1;
    $('calibration-standard-status').textContent = `${standard.count} liquid segments · 100 steps each`;
    csvPreviewMetrics();
    draw();
  } catch (error) {
    if (token === csvReadId) $('calibration-standard-status').textContent = error.message;
  } finally {
    if (token === csvReadId) {
      calibPreviewReading = false;
      csvReading = false;
      syncPlayback();
      startCalibPreview();
    }
  }
}

$('calibration-standard').addEventListener('click', async () => {
  if (projectBusy || (importedCsv && !importedCsv.standard) || csvReading || exporting || previewLoading ||
      !['cylinder', 's-curve'].includes($('tube-type').value)) return;
  exporting = true;
  syncCsvControls();
  $('calibration-standard-status').textContent = '';
  try {
    // Export the exact sequence being previewed, if preview mode is active.
    const standard = importedCsv?.standard || await fetchStandardPattern();
    const blob = new Blob(['\ufeff', standard.source.replace(/^\uFEFF/, '')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'fluixer_standard_100steps.csv');
    $('calibration-standard-status').textContent = `${standard.count} liquid segments · 100 steps each`;
  } catch (error) {
    $('calibration-standard-status').textContent = error.message;
  } finally {
    exporting = false;
    syncCsvControls();
    startCalibPreview();
  }
});
// STANDARD_PREVIEW_END

// Model edits have their own snapshots; camera and playback are intentionally absent.
const editFieldIds = [
  'pattern-type', 'tube-type', 'mapping-type', ...tubeNames.map(n => 'tube-' + n),
  'pre-add', 'length-per-100-steps', 'speed', 'k-gas', 'k-liquid', 'unit',
  'image-mode', 'image-threshold', 'image-invert',
];
function captureEditState() {
  return {
    fields: Object.fromEntries(editFieldIds.map(id => [id, { value: $(id).value, checked: $(id).checked }])),
    curve: { ...structuredClone(curveState), amplitude: $('curve-amplitude').value },
    center: structuredClone(tubeCenter), placement: clonePlane(placement), initialPlacement: clonePlane(initialPlacement),
    tubeStepSource, tubeStepReverse, innerDiameter,
    brushPixels: brushPixels.slice(), brushActive: structuredClone(brushActive),
    spatialWindows: structuredClone(spatialWindows), stepActive: structuredClone(stepActive), stepPlacement: structuredClone(stepPlacement),
    imageActive: structuredClone(imageActive), imageRaster, imagePhoto, imagePhotoSource,
  };
}
function sameEditState(a, b) {
  if (a.imageRaster !== b.imageRaster || a.imagePhotoSource !== b.imagePhotoSource) return false;
  // ImageData is immutable here. Comparing it pixel-by-pixel on every edit is unnecessary.
  const content = s => JSON.stringify({ ...s, imageRaster: null, imagePhoto: null, brushPixels: Array.from(s.brushPixels) });
  return content(a) === content(b);
}
function restoreEditState(s) {
  ++requestId; ++imageReadId; ++imageProcessId; ++stepReadId; ++tubeStepReadId;
  imagePhotoPending = null;
  for (const [id, field] of Object.entries(s.fields)) {
    $(id).value = field.value;
    if (typeof field.checked === 'boolean') $(id).checked = field.checked;
  }
  tubeKind = $('tube-type').value;
  tubeCenter = structuredClone(s.center); placement = clonePlane(s.placement); initialPlacement = clonePlane(s.initialPlacement);
  tubeStepSource = s.tubeStepSource; tubeStepReverse = s.tubeStepReverse;
  $('tube-step-reverse').ariaPressed = String(tubeStepReverse);
  innerDiameter = s.innerDiameter;
  selectedPoint = null;
  setCurve({ ...structuredClone(s.curve), amplitude: Number(s.curve.amplitude) });
  brushPixels = s.brushPixels.slice(); brushActive = structuredClone(s.brushActive);
  spatialWindows = structuredClone(s.spatialWindows);
  stepActive = structuredClone(s.stepActive); stepPlacement = structuredClone(s.stepPlacement); stepDraft = null;
  $('step-apply').disabled = true;
  imageActive = structuredClone(s.imageActive); imageRaster = s.imageRaster;
  imagePhoto = s.imagePhoto; imagePhotoSource = s.imagePhotoSource;
  for (const n of tubeNames) $('tube-slider-' + n).value = $('tube-' + n).value;
  canvas.style.cursor = $('pattern-type').value === 'spatial-brush' ? 'crosshair' : '';
  tubeLabels(); paintBrush(); paintImage(); syncRenderControls(); syncPlaneTools();
  document.querySelectorAll('input[type="range"]').forEach(syncSliderFill);
  loadDisplay();
}
function commitEditHistory() {
  if (!editHistory || projectBusy || csvReading || imageHistoryPending) return;
  editHistory.checkpoint();
}
function syncHistoryButtons() {
  if (!editHistory) return;
  const disabled = projectBusy || csvReading || !editHistory.available();
  $('brush-undo').disabled = disabled;
  $('spatial-undo').disabled = disabled;
}
function moveEditHistory(redo = false) {
  if (!editHistory || projectBusy || csvReading || stepBusy || exporting || imageHistoryPending) return;
  editHistory.move(redo);
}
editHistory = new FluixerHistory.History({
  capture: captureEditState, restore: restoreEditState, equal: sameEditState,
  scope: () => importedCsv && !importedCsv.standard ? importedCsv : null,
  changed: syncHistoryButtons,
});
let editPointer = null;
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('dialog') || projectBusy || csvReading || imageHistoryPending) return;
  if (!event.target.matches('input[type="range"], #brush-canvas, #curve-preview, #preview')) return;
  editHistory.held = true; editPointer = event.pointerId;
}, true);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
  if (event.pointerId !== editPointer) return;
  editPointer = null;
  queueMicrotask(() => { editHistory.held = false; commitEditHistory(); });
});
window.addEventListener('blur', () => {
  editPointer = null;
  queueMicrotask(() => { editHistory.held = false; commitEditHistory(); });
});
for (const name of ['change', 'click']) document.addEventListener(name, event => {
  if (!event.target.closest('dialog')) queueMicrotask(commitEditHistory);
});
document.addEventListener('keydown', event => {
  const action = FluixerHistory.shortcut(event);
  if (!action || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (!event.repeat) moveEditHistory(action === 'redo');
});
syncHistoryButtons();

FluixerSerial.init({
  state: () => ({
    imported: !!importedCsv && !importedCsv.standard,
    available: !!display && !projectBusy && !previewLoading && !csvReading && !exporting &&
      !importedCsv?.standard && (!!importedCsv || display.pattern_config?.type !== 'empty'),
  }),
  source: async compensated => {
    if (importedCsv && !importedCsv.standard) {
      if (!importedCsv.serialSource) throw Error('Import the CSV again before running');
      return importedCsv.serialSource;
    }
    const { response } = await requestOutputCsv(compensated);
    return response.text();
  },
  changed: () => syncCsvControls(),
});
