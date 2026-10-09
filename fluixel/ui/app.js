let spatialWindows = [],
  spatialUndo = [],
  spatialErase = false,
  spatialStroke = null;
function uiColor(name, fallback) {
  return typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement)
        .getPropertyValue('--' + name)
        .trim() || fallback
    : fallback;
}
('use strict');
const $ = (id) => document.getElementById(id),
  canvas = $('preview'),
  ctx = canvas.getContext('2d');
let renderMode = 'lines',
  innerDiameter = 2,
  tubeRenderer = null;
let planeVisible = true,
  placementTube = null,
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
function stopAnimation() {
  animationPlaying = false;
  animationTime = null;
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
  syncPlayback();
}
function syncSliderFill(input) {
  const min = Number(input.min || 0),
    max = Number(input.max || 100),
    value = Number(input.value);
  const fraction =
    max > min && Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  input.style.backgroundSize = `calc(${16 * (0.5 - fraction)}px + ${fraction * 100}%) 100%`;
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
  $('pre-add-slider').value = value;
  syncSliderFill($('pre-add-slider'));
}
setPreAdd(730);
$('pre-add-slider').addEventListener('input', () => setPreAdd(Number($('pre-add-slider').value)));
$('pre-add').addEventListener('input', () => {
  try {
    const value = selectedPreAdd();
    $('pre-add-slider').value = value;
    syncSliderFill($('pre-add-slider'));
  } catch {}
});
function syncPlayback() {
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
    $(id).disabled = !display || projectBusy || previewLoading;
  $('playback-progress').value = Math.round(animationProgress * 1000);
  syncSliderFill($('playback-progress'));
  $('playback-progress').ariaValueText = Math.round(animationProgress * 100) + '%';
}
function resetAnimation() {
  stopAnimation();
  animationProgress = 1;
  motionCache = null;
  motionSource = null;
  syncPlayback();
}
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
  if (progress >= 1) return data.segments;
  if (motionSource !== data) {
    motionCache = motionGeometry(data);
    motionSource = data;
  }
  const result = data.segments.map((s) => ({ phase: 'gas', points: s.points }));
  const interpolate = (edge, d) =>
    edge.a.map((v, j) => v + ((edge.b[j] - v) * (d - edge.start)) / (edge.end - edge.start));
  let cursor = 0;
  for (const [start, end] of movingWindows(data.segments, data.path_length, progress)) {
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
  syncPlayback();
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
  stopAnimation();
  animationProgress = Math.max(0, Math.min(1, next));
  syncPlayback();
  draw();
});
for (const [id, p] of [
  ['playback-start', 0],
  ['playback-final', 1],
])
  $(id).addEventListener('click', () => {
    stopAnimation();
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
function project(point, w, h) {
  const relative = point.map((v, i) => v - modelFrame().center[i]),
    basis = cameraBasis();
  const xx = dot(relative, basis.right),
    zz = dot(relative, basis.up);
  // Positive render depth means farther away; it is not the camera Z axis.
  const depth = -dot(relative, basis.back);
  const scale = viewScale(w, h);
  return [w / 2 + panX + xx * scale, h / 2 + panY - zz * scale, depth];
}
function draw() {
  const rect = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  // World-axis triad uses the same projection as the geometry, never mirrors data.
  const center = modelFrame().center,
    origin = project(center, rect.width, rect.height),
    anchor = [rect.width - 50, 48];
  ctx.font = canvasFont(10);
  ctx.lineWidth = 1.5;
  for (const [point, label, color] of [
    [center.map((v, i) => v + (i === 0 ? 10 : 0)), 'X', '#ae5947'],
    [center.map((v, i) => v + (i === 1 ? 10 : 0)), 'Y', '#55815b'],
    [center.map((v, i) => v + (i === 2 ? 10 : 0)), 'Z', '#47778e'],
  ]) {
    const end = project(point, rect.width, rect.height),
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
      const a = project(segment.points[i - 1], rect.width, rect.height),
        b = project(segment.points[i], rect.width, rect.height);
      strokes.push({ a, b, depth: (a[2] + b[2]) / 2, phase: segment.phase });
    }
  }
  strokes.sort((a, b) => b.depth - a.depth);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const near = 1 - Math.max(0, Math.min(1, (s.depth + 50) / 100));
    ctx.globalAlpha = s.phase === 'liquid' ? 0.55 + near * 0.45 : 0.22 + near * 0.48;
    ctx.strokeStyle =
      s.phase === 'liquid' ? uiColor('accent-text', '#C2141C') : uiColor('secondary', '#585A5A');
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
  if (c.mapping !== undefined && !['projection', 'path'].includes(c.mapping))
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
    ['projection', 'path'].includes(a.mapping || 'projection') &&
    ['projection', 'path'].includes(b.mapping || 'projection') &&
    (a.type || 'cylinder') === (b.type || 'cylinder') &&
    tubeNames.every((n) => a[n] === b[n])
  );
}
let tubeKind = 'cylinder';
function tubeLabels() {
  $('geometry-compensation').hidden = !['cylinder', 's-curve'].includes($('tube-type').value);
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
  placementTube = { ...c };
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
  $('tube-slider-' + n).addEventListener('change', loadDisplay);
}
$('tube-reset').addEventListener('click', () => {
  innerDiameter = 2;
  const type = $('tube-type').value,
    mapping = $('mapping-type').value;
  if (type === 'custom-step') {
    tubeStepReverse = false;
    $('tube-step-reverse').ariaPressed = 'false';
    $('tube-diameter').value = 4;
    $('tube-slider-diameter').value = 4;
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
    placement: savedPlane,
    initial_placement: savedInitial,
    ...(center ? { center } : {}),
    ...(type !== 'cylinder' ? { type } : {}),
    ...(type === 'hilbert' ? { wind: 3 } : {}),
    ...(mapping === 'path' ? { mapping } : {}),
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
  $('tube-step-status').textContent = '';
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
    $('tube-step-status').textContent = file.name + ' · Open · G0 continuous';
    await loadDisplay();
  } catch (error) {
    if (id === tubeStepReadId) $('tube-step-status').textContent = error.message;
  }
});
function validateRectangle(shape, tube = DEFAULT_TUBE) {
  tube = patternFrame(tube);
  if (
    !shape ||
    typeof shape !== 'object' ||
    Array.isArray(shape) ||
    Object.keys(shape).sort().join('|') !== 'height|type|width|x|z' ||
    shape.type !== 'rectangle'
  )
    throw Error('Incomplete rectangle parameters');
  for (const n of ['width', 'height', 'x', 'z'])
    if (typeof shape[n] !== 'number' || !Number.isFinite(shape[n]))
      throw Error('Rectangle parameters must be finite numbers');
  if (
    shape.width <= 0 ||
    shape.height <= 0 ||
    shape.x < 0 ||
    shape.z < 0 ||
    shape.x + shape.width > 2 * tube.radius ||
    shape.z + shape.height > tube.height
  )
    throw Error('Rectangle exceeds tube bounds. Adjust its size or position');
  return shape;
}
function sameRectangle(a, b) {
  return !!b && b.type === 'rectangle' && ['width', 'height', 'x', 'z'].every((n) => a[n] === b[n]);
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
  validateRectangle(
    { type: 'rectangle', width: shape.width, height: shape.height, x: shape.x, z: shape.z },
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
function fetchDisplay(mode, shape, curve, tube) {
  if (
    tube.type === 'custom-step' ||
    ['step', 'brush', 'image', 'empty', 'spatial-brush'].includes(shape.type)
  )
    return fetch('/api/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calibration: mode,
        pattern: shape,
        compensation: curve,
        cylinder: tube,
      }),
    });
  return fetch(displayURL(mode, shape, curve, tube));
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
const LEGACY_CURVE = {
  amplitude: 40,
  x: [0, 0, 0.9918989539146423, 1],
  y: [0.5957211256027222, 0, 0, 0],
};
const DEFAULT_CURVE = { amplitude: 40, x: [0, 1 / 3, 2 / 3, 1], y: [0, 0, 0, 0] };
$('brush-size').addEventListener('input', () => syncSliderFill($('brush-size')));
syncSliderFill($('brush-size'));
const BRUSH_SIZE = 256,
  brushControls = ['brush-pen', 'brush-eraser', 'brush-size', 'brush-undo', 'brush-clear'];
let brushPixels = new Uint8Array(BRUSH_SIZE * BRUSH_SIZE),
  brushHistory = [],
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
  validateRectangle(
    { type: 'rectangle', width: shape.width, height: shape.height, x: shape.x, z: shape.z },
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
  $('brush-undo').disabled = !brushHistory.length || projectBusy;
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
    $('export').disabled = true;
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
  else {
    brushHistory.push(stroke.before);
    if (brushHistory.length > 30) brushHistory.shift();
  }
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
$('brush-undo').addEventListener('click', () => {
  if (projectBusy) return;
  finishBrush(true);
  if (brushHistory.length) {
    brushPixels = brushHistory.pop();
    paintBrush();
    updateBrushPreview();
  }
});
$('brush-clear').addEventListener('click', () => {
  if (projectBusy) return;
  finishBrush(true);
  if (brushPixels.some((v) => v)) {
    brushHistory.push(brushPixels.slice());
    if (brushHistory.length > 30) brushHistory.shift();
    brushPixels.fill(0);
    paintBrush();
    updateBrushPreview();
  }
});
function restoreBrush(shape) {
  finishBrush(true, true);
  brushPixels = Uint8Array.from(JSON.parse(shape.source).rows.join(''), (v) => Number(v));
  brushHistory = [];
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
    Object.keys(c).sort().join('|') !== 'amplitude|x|y' ||
    !Array.isArray(c.x) ||
    !Array.isArray(c.y) ||
    c.x.length < 2 ||
    c.x.length > 12 ||
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
    c.x.some((v, i) => i > 0 && v < c.x[i - 1])
  )
    throw Error('X must be ordered within 0–1; Y must be within -1–1');
  return c;
}
function selectedCurve() {
  for (const id of curveIds)
    if (String($(id).value).trim() === '') throw Error('Complete all compensation parameters');
  return validateCurve({
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
function pointButtons(c) {
  $('curve-selection').textContent =
    c.x.length +
    ' control points' +
    (selectedPoint === null ? '' : ' · Selected P' + selectedPoint);
}
function bezierCoordinate(values, t) {
  let v = [...values];
  while (v.length > 1) v = v.slice(0, -1).map((a, i) => (1 - t) * a + t * v[i + 1]);
  return v[0];
}

function drawCurve(c) {
  pointButtons(c);
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
  for (let j = 1; j <= 160; j++)
    g.lineTo(px(bezierCoordinate(c.x, j / 160)), py(bezierCoordinate(c.y, j / 160)));
  g.stroke();
  g.fillStyle = uiColor('primary', '#1C1C1C');
  g.font = canvasFont(10);
  for (let i = 0; i < c.x.length; i++) {
    g.beginPath();
    g.arc(px(c.x[i]), py(c.y[i]), i === selectedPoint ? 6 : 3, 0, Math.PI * 2);
    g.fill();
    g.fillText('P' + i, Math.min(248, px(c.x[i]) + 4), Math.max(12, py(c.y[i]) - 5));
  }
  g.fillText('0', 24, 272);
  g.fillText('1', 260, 272);
  g.fillText('+1', 3, 20);
  g.fillText('0', 8, 139);
  g.fillText('-1', 3, 258);
}
function sameCurve(a, b) {
  return (
    !!b &&
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
  return [((e.clientX - r.left) * 280) / r.width, ((e.clientY - r.top) * 280) / r.height];
}
curveCanvas.addEventListener('pointerdown', (e) => {
  if (projectBusy || curveDrag || e.altKey || !e.isPrimary || e.button !== 0) return;
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
  if (i > 0 && i < c.x.length - 1)
    c.x[i] = Math.max(c.x[i - 1], Math.min(c.x[i + 1], (x - 24) / 240));
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
  if (projectBusy || curveDrag || e.button !== 0) return;
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
    if (best >= 0 || c.x.length >= 12) return;
    let point = null,
      nearest = 9;
    for (let j = 1; j < 400; j++) {
      const px = bezierCoordinate(c.x, j / 400),
        py = bezierCoordinate(c.y, j / 400),
        d = Math.hypot(x - 24 - 240 * px, y - 136 + 120 * py);
      if (d < nearest) {
        nearest = d;
        point = [px, py];
      }
    }
    if (!point) return;
    const i = c.x.findIndex((v) => v > point[0]);
    if (i <= 0) return;
    c.x.splice(i, 0, point[0]);
    c.y.splice(i, 0, point[1]);
    selectedPoint = i;
  }
  e.preventDefault();
  setCurve(c);
  loadDisplay();
});
function displayURL(mode, shape, curve = DEFAULT_CURVE, tube = DEFAULT_TUBE) {
  let url = '/api/display?calibration=' + mode;
  if (shape.type === 'rectangle') {
    validateRectangle(shape, tube);
    url += '&pattern=rectangle';
    for (const n of ['width', 'height', 'x', 'z'])
      url += '&' + n + '=' + encodeURIComponent(shape[n]);
  }
  url += '&cylinder=' + encodeURIComponent(JSON.stringify(tube));
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
  // Freeze old projects' plane dimensions before their first tube edit.
  if (placement && !placement.size) {
    const previous = placementTube || next;
    placement.size = [previous.radius * 2, previous.height];
  }
  placementTube = { ...next };
}
function loadDisplay() {
  followTubeResize();
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
    } else syncPlayback();
  });
  return previewTask;
}
async function renderDisplay(current) {
  resetAnimation();
  tubeAvailability();
  const mode = 'compensated';
  $('spatial-fields').hidden = $('pattern-type').value !== 'spatial-brush';
  $('image-fields').hidden = $('pattern-type').value !== 'image';
  $('brush-fields').hidden = $('pattern-type').value !== 'brush';
  $('step-fields').hidden = $('pattern-type').value !== 'step';
  syncPlayback();
  draw();
  $('export').disabled = true;
  $('project-save').disabled = true;
  $('project-open').disabled = true;
  status('', false, true);
  $('export-status').textContent = '';
  for (const id of ['total', 'liquid-total', 'count']) $(id).textContent = '—';
  try {
    const requestedPattern = selectedPattern(),
      requestedCurve = selectedCurve(),
      requestedTube = selectedTube();
    const response = await fetchDisplay(mode, requestedPattern, requestedCurve, requestedTube);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Calculation failed');
    if (current !== requestId && !previewQueued) return;
    if (
      requestedPattern.type === 'rectangle' &&
      !sameRectangle(requestedPattern, data.pattern_config)
    )
      throw Error('Pattern response mismatch. Restart the local server');
    if (requestedPattern.type === 'image' && !sameImage(requestedPattern, data.pattern_config))
      throw Error('Image result mismatch');
    if (requestedPattern.type === 'brush' && !sameBrush(requestedPattern, data.pattern_config))
      throw Error('Brush result mismatch');
    if (requestedPattern.type === 'step' && !sameStep(requestedPattern, data.pattern_config))
      throw Error('STEP result does not match the current pattern');
    if (!sameCurve(requestedCurve, data.compensation))
      throw Error('Compensation parameter response mismatch. Restart the local server');
    if (!sameTube(requestedTube, data.cylinder || DEFAULT_TUBE))
      throw Error('Tube parameter response mismatch. Restart the server');
    if (
      requestedPattern.type === 'spatial-brush' &&
      JSON.stringify(requestedPattern) !== JSON.stringify(data.pattern_config)
    )
      throw Error('Spatial brush result mismatch');
    display = data;
    $('total').textContent = data.path_length.toFixed(2) + ' mm';
    $('liquid-total').textContent = data.liquid_length.toFixed(2) + ' mm';
    $('count').textContent = data.segments.length;
    const pending = current !== requestId;
    status('', false, pending);
    $('export').disabled = exporting || pending || requestedPattern.type === 'empty';
    $('project-save').disabled = pending || requestedPattern.type === 'empty';
    $('project-open').disabled = pending;
    syncPlayback();
    draw();
  } catch (error) {
    if (current === requestId) {
      if (!placement) display = null;
      draw();
      status(error.message + '. Check the parameters or local server.', true);
      $('project-open').disabled = false;
    }
  }
}
$('pattern-type').addEventListener('change', loadDisplay);
$('contours').addEventListener('change', draw);
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
  draw();
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
    draw();
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
  draw();
});
new ResizeObserver(draw).observe(canvas);
$('export-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!display || exporting || previewLoading) return;
  exporting = true;
  $('export').disabled = true;
  try {
    const data = {
      cylinder: display.cylinder || DEFAULT_TUBE,
      compensation: display.compensation || DEFAULT_CURVE,
      pattern: display.pattern_config || { type: 'captured-s' },
      calibration: display.calibration,
      pre_add: selectedPreAdd(),
      speed: Number($('speed').value),
      k_gas: Number($('k-gas').value),
      k_liquid: Number($('k-liquid').value),
      unit: $('unit').value,
    };
    $('export-status').textContent = 'Generating CSV…';
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw Error(error.error || 'Export failed');
    }
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `fluixel_${data.unit}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('export-status').textContent =
      `Generated ${response.headers.get('X-Row-Count')} rows. Browser download requested (${data.unit}).`;
  } catch (error) {
    $('export-status').textContent = 'Export failed: ' + error.message;
  } finally {
    exporting = false;
    $('export').disabled = !display || previewLoading;
  }
});
const PROJECT_FORMAT = 'fluixer-project',
  PRESET_ID = 'captured-s-cylinder-20260923';
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
  keys(
    value,
    value.schema_version >= 4
      ? [
          'format',
          'schema_version',
          'preset',
          'pattern',
          'compensation',
          'cylinder',
          'calibration',
          'machine',
          'view',
        ]
      : value.schema_version === 3
        ? [
            'format',
            'schema_version',
            'preset',
            'pattern',
            'compensation',
            'calibration',
            'machine',
            'view',
          ]
        : value.schema_version === 2
          ? ['format', 'schema_version', 'preset', 'pattern', 'calibration', 'machine', 'view']
          : ['format', 'schema_version', 'preset', 'calibration', 'machine', 'view'],
  );
  if (value.preset === 'rectangle' || value.pattern?.type === 'rectangle')
    throw Error('Custom rectangles have been removed. Use STEP or brush patterns');
  if (value.format !== PROJECT_FORMAT || ![1, 2, 3, 4, 5, 6, 7, 8].includes(value.schema_version))
    throw Error('Unsupported project format or version');
  if (value.schema_version === 1 && value.preset !== PRESET_ID)
    throw Error('The project pattern preset is not supported');
  if (value.schema_version === 2) {
    if (value.preset !== 'rectangle') throw Error('Invalid project pattern');
    validateRectangle(value.pattern);
  }
  if (value.schema_version >= 3) {
    validateCurve(value.compensation);
    if (value.schema_version >= 4) validateTube(value.cylinder);
    if (value.schema_version === 8 && value.preset === 'spatial-brush')
      validateSpatialPattern(value.pattern);
    else if (value.schema_version === 7 && value.preset === 'image')
      validateImagePattern(value.pattern, value.cylinder);
    else if (value.schema_version === 6 && value.preset === 'brush')
      validateBrushPattern(value.pattern, value.cylinder);
    else if (value.schema_version === 5 && value.preset === 'step')
      validateStepPattern(value.pattern, value.cylinder);
    else if (value.preset === 'rectangle')
      validateRectangle(value.pattern, value.cylinder || DEFAULT_TUBE);
    else if (
      value.preset !== PRESET_ID ||
      JSON.stringify(value.pattern) !== JSON.stringify({ type: 'captured-s' })
    )
      throw Error('Invalid project pattern');
  }
  if (!['original', 'compensated'].includes(value.calibration))
    throw Error('Invalid project compensation mode');
  keys(value.machine, [
    'speed',
    'k_gas',
    'k_liquid',
    'unit',
    ...(Object.hasOwn(value.machine || {}, 'pre_add') ? ['pre_add'] : []),
  ]);
  if (
    Object.hasOwn(value.machine, 'pre_add') &&
    (typeof value.machine.pre_add !== 'number' ||
      !Number.isFinite(value.machine.pre_add) ||
      value.machine.pre_add < 0 ||
      value.machine.pre_add > 10000)
  )
    throw Error('Pre-Add must be between 0 and 10000 mm');
  keys(value.view, [
    'yaw',
    'pitch',
    'zoom',
    'pan_x',
    'pan_y',
    'contours',
    ...(value.view?.render ? ['render'] : []),
    ...(Object.hasOwn(value.view || {}, 'plane_visible') ? ['plane_visible'] : []),
  ]);
  if (Object.hasOwn(value.view, 'plane_visible') && typeof value.view.plane_visible !== 'boolean')
    throw Error('Invalid pattern plane visibility setting');
  if (value.view.render) {
    const r = value.view.render;
    keys(r, ['mode', 'inner']);
    if (
      !['lines', 'render'].includes(r.mode) ||
      !Number.isFinite(r.inner) ||
      r.inner <= 0 ||
      r.inner >= (value.cylinder || DEFAULT_TUBE).diameter
    )
      throw Error('Invalid inner or outer tube diameter');
  }
  for (const key of ['speed', 'k_gas', 'k_liquid']) {
    if (!Number.isSafeInteger(value.machine[key]) || value.machine[key] < 0)
      throw Error('Project speed and k parameters must be nonnegative integers');
  }
  if (!['steps', 'segments'].includes(value.machine.unit))
    throw Error('Invalid project output unit');
  const ranges = {
    yaw: [-Math.PI, Math.PI],
    pitch: [-1.4, 1.4],
    zoom: [0.1, 10],
    pan_x: [-1e6, 1e6],
    pan_y: [-1e6, 1e6],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = value.view[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw Error('Invalid project camera parameter: ' + key);
  }
  if (typeof value.view.contours !== 'boolean')
    throw Error('Invalid project contour visibility setting');
  return JSON.parse(JSON.stringify(value));
}
function migrateProjectForDisplay(value) {
  const project = validateProject(value);
  // Old Original files stored a dormant curve. Preserve their effective zero offset.
  if (project.calibration === 'original') {
    project.calibration = 'compensated';
    project.compensation = JSON.parse(JSON.stringify(DEFAULT_CURVE));
    project.pattern = project.pattern || { type: 'captured-s' };
    if (project.schema_version < 3) project.schema_version = 3;
  }
  const c = project.cylinder || { ...DEFAULT_TUBE };
  c.initial_placement = c.initial_placement || defaultPlacement(c);
  c.placement = c.placement || clonePlane(c.initial_placement);
  project.cylinder = c;
  project.schema_version = Math.max(4, project.schema_version);
  project.pattern = project.pattern || { type: 'captured-s' };
  project.compensation = project.compensation || clonePlane(LEGACY_CURVE);
  return project;
}
function currentProject() {
  const rect = canvas.getBoundingClientRect();
  const shape = display.pattern_config;
  return validateProject({
    format: PROJECT_FORMAT,
    ...(shape?.type === 'rectangle'
      ? { schema_version: 2, preset: 'rectangle', pattern: shape }
      : { schema_version: 1, preset: PRESET_ID }),
    calibration: display.calibration,
    ...(!sameCurve(display.compensation || LEGACY_CURVE, LEGACY_CURVE)
      ? {
          schema_version: 3,
          pattern: shape || { type: 'captured-s' },
          compensation: display.compensation,
        }
      : {}),
    ...(!sameTube(display.cylinder || DEFAULT_TUBE, DEFAULT_TUBE)
      ? {
          schema_version: 4,
          pattern: shape,
          cylinder: display.cylinder,
          compensation: display.compensation || LEGACY_CURVE,
        }
      : {}),
    ...(shape?.type === 'spatial-brush'
      ? {
          schema_version: 8,
          preset: 'spatial-brush',
          pattern: shape,
          cylinder: display.cylinder || DEFAULT_TUBE,
          compensation: display.compensation || DEFAULT_CURVE,
        }
      : {}),
    ...(shape?.type === 'image'
      ? {
          schema_version: 7,
          preset: 'image',
          pattern: shape,
          cylinder: display.cylinder || DEFAULT_TUBE,
          compensation: display.compensation || DEFAULT_CURVE,
        }
      : {}),
    ...(shape?.type === 'brush'
      ? {
          schema_version: 6,
          preset: 'brush',
          pattern: shape,
          cylinder: display.cylinder || DEFAULT_TUBE,
          compensation: display.compensation || DEFAULT_CURVE,
        }
      : {}),
    ...(shape?.type === 'step'
      ? {
          schema_version: 5,
          preset: 'step',
          pattern: shape,
          cylinder: display.cylinder || DEFAULT_TUBE,
          compensation: display.compensation || DEFAULT_CURVE,
        }
      : {}),
    machine: {
      ...(selectedPreAdd() !== 730 ? { pre_add: selectedPreAdd() } : {}),
      speed: Number($('speed').value),
      k_gas: Number($('k-gas').value),
      k_liquid: Number($('k-liquid').value),
      unit: $('unit').value,
    },
    view: {
      ...(!planeVisible ? { plane_visible: false } : {}),
      ...(renderMode !== 'lines' || innerDiameter !== 2
        ? { render: { mode: renderMode, inner: innerDiameter } }
        : {}),
      yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      pitch,
      zoom,
      pan_x: panX / rect.width,
      pan_y: panY / rect.height,
      contours: $('contours').checked,
    },
  });
}
function restoreProject(project, data) {
  // Commit only after both project validation and geometry calculation succeed.
  if (data.calibration !== project.calibration)
    throw Error('Calculation result does not match the project compensation mode');
  if (project.pattern?.type === 'rectangle' && !sameRectangle(project.pattern, data.pattern_config))
    throw Error('Pattern response mismatch. Restart the local server');
  if (project.pattern?.type === 'image' && !sameImage(project.pattern, data.pattern_config))
    throw Error('Image result mismatch');
  if (project.pattern?.type === 'brush' && !sameBrush(project.pattern, data.pattern_config))
    throw Error('Brush result mismatch');
  if (project.pattern?.type === 'step' && !sameStep(project.pattern, data.pattern_config))
    throw Error('STEP result mismatch');
  if (project.schema_version >= 3 && !sameCurve(project.compensation, data.compensation))
    throw Error('Compensation parameter response mismatch');
  if (!sameTube(project.cylinder || DEFAULT_TUBE, data.cylinder || DEFAULT_TUBE))
    throw Error('Tube parameter response mismatch');
  if (
    project.pattern?.type === 'spatial-brush' &&
    JSON.stringify(project.pattern) !== JSON.stringify(data.pattern_config)
  )
    throw Error('Spatial brush result mismatch');
  setTube(project.cylinder || DEFAULT_TUBE);
  setCurve(project.compensation || LEGACY_CURVE);
  endDrag();
  display = data;
  resetAnimation();
  const shape = project.pattern || { type: 'captured-s' };
  $('pattern-type').value = shape.type;
  $('spatial-fields').hidden = shape.type !== 'spatial-brush';
  if (shape.type === 'spatial-brush') {
    spatialWindows = shape.windows.map((w) => w.slice());
    spatialUndo = [];
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
    imageActive = shape;
    paintImage();
  }
  $('brush-fields').hidden = shape.type !== 'brush';
  if (shape.type === 'brush') restoreBrush(shape);
  $('step-fields').hidden = shape.type !== 'step';
  if (shape.type === 'step') {
    stepActive = shape;
    stepDraft = null;
    stepPlacement = Object.fromEntries(['width', 'height', 'x', 'z'].map((n) => [n, shape[n]]));
    $('step-status').textContent = 'Project STEP validated and restored.';
    $('step-apply').disabled = true;
  }
  setPreAdd(project.machine.pre_add ?? 730);
  $('speed').value = project.machine.speed;
  $('k-gas').value = project.machine.k_gas;
  $('k-liquid').value = project.machine.k_liquid;
  $('unit').value = project.machine.unit;
  const rect = canvas.getBoundingClientRect();
  planeVisible = project.view.plane_visible !== false;
  syncPlaneTools();
  yaw = project.view.yaw;
  pitch = project.view.pitch;
  zoom = project.view.zoom;
  renderMode = project.view.render?.mode || 'lines';
  innerDiameter = project.view.render?.inner || 2;
  syncRenderControls();
  panX = project.view.pan_x * rect.width;
  panY = project.view.pan_y * rect.height;
  $('contours').checked = project.view.contours;
  $('total').textContent = data.path_length.toFixed(2) + ' mm';
  $('liquid-total').textContent = data.liquid_length.toFixed(2) + ' mm';
  $('count').textContent = data.segments.length;
  $('export-status').textContent = '';
  status('');
  draw();
}
$('project-save').addEventListener('click', () => {
  if (!display || projectBusy || previewLoading) return;
  try {
    if (!$('export-form').reportValidity()) return;
    const project = currentProject(),
      blob = new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'Fluixer-project.fluixer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    'pre-add',
    'pre-add-slider',
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
    const project = migrateProjectForDisplay(
      JSON.parse((await file.text()).replace(/^\uFEFF/, '')),
    );
    let parsedStep = null;
    if (project.pattern?.type === 'step') {
      const check = await fetch('/api/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: project.pattern.source }),
      });
      parsedStep = await check.json();
      if (!check.ok) throw Error(parsedStep.error || 'STEP validation failed');
    }
    const response = await fetchDisplay(
        project.calibration,
        project.pattern || { type: 'captured-s' },
        project.compensation || LEGACY_CURVE,
        project.cylinder || DEFAULT_TUBE,
      ),
      data = await response.json();
    if (!response.ok) throw Error(data.error || 'Project calculation failed');
    restoreProject(project, data);
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
    pointButtons(curveState);
    tubeAvailability();
    paintBrush();
    $('step-apply').disabled = !stepDraft;
    $('export').disabled = !display || exporting;
    $('project-save').disabled = !display;
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
    screen = (p) => project(p, rect.width, rect.height),
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
    $(id).disabled = projectBusy;
  }
  $('plane-toggle').ariaPressed = String(!!placement && planeVisible);
}
for (const [id, mode] of [
  ['tool-gumball', 'gumball'],
  ['tool-direction', 'direction'],
])
  $(id).addEventListener('click', () => {
    if (projectBusy) return;
    planeVisible = true;
    $('plane-tool').value = mode;
    syncPlaneTools();
    draw();
  });
$('plane-toggle').addEventListener('click', () => {
  planeVisible = !planeVisible;
  syncPlaneTools();
  draw();
});
$('plane-reset').addEventListener('click', () => {
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
  $('spatial-undo').disabled = projectBusy || !spatialUndo.length;
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
$('spatial-undo').addEventListener('click', () => {
  if (projectBusy) return;
  if (spatialUndo.length) {
    spatialWindows = spatialUndo.pop();
    loadDisplay();
  }
});
$('spatial-clear').addEventListener('click', () => {
  if (projectBusy || !spatialWindows.length) return;
  spatialUndo.push(spatialWindows.map((w) => w.slice()));
  spatialWindows = [];
  loadDisplay();
});
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (
      e.button !== 0 ||
      $('pattern-type').value !== 'spatial-brush' ||
      !display ||
      projectBusy ||
      previewLoading
    )
      return;
    e.preventDefault();
    stopAnimation();
    animationProgress = 1;
    const rect = canvas.getBoundingClientRect();
    spatialUndo.push(spatialWindows.map((w) => w.slice()));
    if (spatialUndo.length > 50) spatialUndo.shift();
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
$('pattern-type').addEventListener('change', () => {
  spatialStroke = null;
  canvas.style.cursor = $('pattern-type').value === 'spatial-brush' ? 'crosshair' : '';
});

$('tube-type').addEventListener('change', () => {
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

function selectSidebarTab(key, focus = false) {
  for (const name of ['project', 'pattern', 'tube', 'export']) {
    const button = $('tab-' + name),
      active = name === key;
    button.ariaSelected = String(active);
    button.tabIndex = active ? 0 : -1;
    $('panel-' + name).hidden = !active;
    if (active && focus) button.focus();
  }
  if (key === 'tube') drawCurve(curveState);
  if (key === 'pattern') {
    paintBrush();
    if (stepDraft) drawStepDraft();
  }
}

for (const key of ['project', 'pattern', 'tube', 'export']) {
  const button = $('tab-' + key);
  button.addEventListener('click', () => selectSidebarTab(key));
  button.addEventListener('keydown', (event) => {
    const keys = ['project', 'pattern', 'tube', 'export'].filter((k) => !$('tab-' + k).hidden);
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
