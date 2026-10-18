// Photo measurement runs locally. Positions are always in decoded image pixels.
(function (root) {
  'use strict';
  const defaults = { hLow: 26, hHigh: 32, sLow: 130, vLow: 230, minArea: 150, closeK: 0 };
  function hsv(r, g, b) {
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
    let h = !d ? 0 : hi === r ? (g - b) / d : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    if (h < 0) h += 6;
    return [h * 30, hi ? d / hi * 255 : 0, hi];
  }
  function morphology(mask, w, h, radius, dilate) {
    const sum = new Int32Array((w + 1) * (h + 1)), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += mask[y * w + x];
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - radius), r = Math.min(w, x + radius + 1);
      const t = Math.max(0, y - radius), b = Math.min(h, y + radius + 1);
      const count = sum[b * (w + 1) + r] - sum[t * (w + 1) + r] - sum[b * (w + 1) + l] + sum[t * (w + 1) + l];
      out[y * w + x] = dilate ? Number(count > 0) : Number(count === (r - l) * (b - t));
    }
    return out;
  }
  function detect(data, w, h, settings = defaults) {
    const p = { ...defaults, ...settings };
    if (![w, h].every(v => Number.isInteger(v) && v > 0) || data.length !== w * h * 4) throw Error('Invalid photo');
    if (p.hLow > p.hHigh) throw Error('Hue minimum must not exceed hue maximum');
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
      const [hue, s, v] = hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      mask[i] = Number(data[i * 4 + 3] >= 128 && (p.hCenter == null ? hue >= p.hLow && hue <= p.hHigh : Math.min(Math.abs(hue - p.hCenter), 180 - Math.abs(hue - p.hCenter)) <= p.hRadius) && s >= p.sLow && v >= p.vLow);
    }
    mask = morphology(morphology(mask, w, h, 1, false), w, h, 1, true);
    const radius = Math.floor(p.closeK / 2);
    if (radius) mask = morphology(morphology(mask, w, h, radius, true), w, h, radius, false);
    const seen = new Uint8Array(w * h), queue = new Int32Array(w * h), points = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      let head = 0, tail = 1, left = w, right = 0, top = h, bottom = 0;
      queue[0] = i; seen[i] = 1;
      while (head < tail) {
        const j = queue[head++], x = j % w, y = Math.floor(j / w);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, k = ny * w + nx;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[k] && !seen[k]) { seen[k] = 1; queue[tail++] = k; }
        }
      }
      if (tail >= p.minArea) points.push({ x: right, y: (top + bottom) / 2, left, top, bottom, area: tail });
    }
    return points.sort((a, b) => a.y - b.y);
  }
  function autoSettings(data, w, h) {
    const samples = [], histogram = new Uint32Array(180);
    const stride = Math.max(1, Math.floor(w * h / 120000));
    for (let i = 0; i < w * h; i += stride) {
      if (data[i * 4 + 3] < 128) continue;
      const [hue, saturation, value] = hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      // Yellow liquid is the measured material; ignore neutral cylinder/background pixels.
      if (hue >= 18 && hue <= 40 && saturation >= 70 && value >= 60) {
        samples.push([hue, saturation, value]); histogram[Math.round(hue)]++;
      }
    }
    if (samples.length < 12) return { ...defaults };
    let peak = 29;
    for (let h = 18; h <= 40; h++) if (histogram[h] > histogram[peak]) peak = h;
    const selected = samples.filter(p => Math.abs(p[0] - peak) <= 3);
    const quantile = (index, fraction) => {
      const values = selected.map(p => p[index]).sort((a, b) => a - b);
      return values[Math.floor((values.length - 1) * fraction)];
    };
    const base = { hLow: Math.max(0, peak - 3), hHigh: Math.min(179, peak + 3),
      sLow: Math.round(quantile(1, .2) * .9), vLow: Math.round(quantile(2, .6) * .96),
      minArea: Math.max(9, Math.round(w * h * .00002)), closeK: 0 };
    const regions = detect(data, w, h, base).filter(p => p.x - p.left >= (p.bottom - p.top) * 1.5);
    if (regions.length >= 2) base.minArea = Math.max(9, Math.min(3000, Math.round(median(regions.map(p => p.area)) * .2)));
    return base;
  }
  // Sample original image pixels, never the endpoint/scale overlays.
  function pickedSettings(data, w, h, x, y, base = defaults) {
    x = Math.max(0, Math.min(w - 1, Math.floor(x)));
    y = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const i = (y * w + x) * 4;
    const [hue, saturation, value] = hsv(data[i], data[i + 1], data[i + 2]);
    if (data[i + 3] < 128 || saturation < 30 || value < 20)
      throw Error('Select a colored liquid area, away from glare or shadows');
    return { ...base, hCenter: hue, hRadius: 6,
      sLow: Math.max(30, Math.round(saturation * .55)),
      vLow: Math.max(20, Math.round(value * .55)) };
  }
  function adjustedSettings(base, sensitivity = 50, noise = 50) {
    const delta = (sensitivity - 50) / 50;
    return { ...base,
      ...(base.hCenter == null ? {} : { hRadius: Math.max(1, base.hRadius + delta * 5) }),
      hLow: Math.max(0, base.hLow - Math.round(delta * 3)),
      hHigh: Math.min(179, base.hHigh + Math.round(delta * 3)),
      sLow: Math.max(0, Math.min(255, Math.round(base.sLow - delta * 60))),
      vLow: Math.max(0, Math.min(255, Math.round(base.vLow - delta * 60))),
      minArea: Math.max(1, Math.round(base.minArea * Math.pow(4, (noise - 50) / 50))), closeK: 0 };
  }
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };

  // Look above the liquid: exposed cylinder edges, not the tube's outer diameter.
  // A stable bright cylinder against a darker background is required; no guessed scale.
  function cylinderScale(data, w, h, points) {
    if (points.length < 2) throw Error('Mark at least two endpoints or adjust the thresholds');
    const top = Math.min(...points.map(p => p.y));
    const leftPoint = Math.min(...points.map(p => p.left ?? p.x)), rightPoint = Math.max(...points.map(p => p.x));
    const center = (leftPoint + rightPoint) / 2;
    const gray = (x, y) => { const i = (y * w + x) * 4; return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; };
    const rows = [], pad = Math.max(2, Math.round(w / 400));
    const begin = Math.max(pad, Math.floor(top - h * .28)), end = Math.max(begin, Math.floor(top - h * .07));
    for (let y = begin; y < end; y += Math.max(1, Math.round(h / 350))) {
      if (gray(Math.round(center), y) < 65) continue;
      let l = -1, r = -1, lg = 0, rg = 0;
      for (let x = pad; x < Math.min(leftPoint - pad, center - w * .05); x++) {
        const delta = gray(x + pad, y) - gray(x - pad, y);
        if (delta > lg) { lg = delta; l = x; }
      }
      for (let x = Math.max(Math.ceil(rightPoint + pad), Math.ceil(center + w * .05)); x < w - pad; x++) {
        const delta = gray(x - pad, y) - gray(x + pad, y);
        if (delta > rg) { rg = delta; r = x; }
      }
      if (lg >= 18 && rg >= 25 && r - l >= w * .15 && r - l <= w * .9 && l > pad && r < w - pad - 1) rows.push({ l, r, y });
    }
    if (rows.length < 6) throw Error('80 mm cylinder edges not found. Use a front-facing photo with both exposed edges visible');
    // The first stable side-wall band avoids the curved top rim and later tubing.
    let stable = [];
    for (const candidate of rows) {
      const tolerance = Math.max(3, (candidate.r - candidate.l) * .02);
      const band = rows.filter(r => r.y >= candidate.y && r.y <= candidate.y + h * .04);
      const consistent = band.filter(r => Math.abs(r.l - candidate.l) <= tolerance && Math.abs(r.r - candidate.r) <= tolerance);
      if (consistent.length >= 6 && consistent.length >= band.length * .45 && consistent[consistent.length - 1].y - consistent[0].y >= h * .012) { stable = consistent; break; }
    }
    if (!stable.length) throw Error('Cylinder boundary is ambiguous. Use a clearer, front-facing photo');
    const l = median(stable.map(r => r.l)), r = median(stable.map(r => r.r));
    return { left: l, right: r, y: median(stable.map(r => r.y)), mmPerPixel: 80 / (r - l), support: stable.length };
  }

  function slopes(xs, ys) {
    const n = xs.length, h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
    if (n === 2) return [d[0], d[0]];
    function end(h0, h1, d0, d1) {
      let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (v * d0 <= 0) v = 0;
      else if (d0 * d1 <= 0 && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0;
      return v;
    }
    m[0] = end(h[0], h[1], d[0], d[1]);
    m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    for (let i = 1; i < n - 1; i++) {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = d[i - 1] * d[i] <= 0 ? 0 : (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
    return m;
  }
  function interpolate(x, xs, ys) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    const m = slopes(xs, ys);
    let i = 0;
    while (xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  }
  function measurement(points, scale) {
    if (points.length < 2 || points.length > 256) throw Error('Use 2–256 endpoints');
    if (!Number.isFinite(scale) || scale <= 0 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Invalid measurement');
    const pts = [...points].sort((a, b) => a.y - b.y);
    if (pts.some((p, i) => i && p.y - pts[i - 1].y < 1)) throw Error('Use one endpoint per liquid segment at distinct heights');
    const center = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const offsets = pts.map(p => (center - p.x) * scale);
    const amplitude = Math.max(...offsets.map(Math.abs));
    if (amplitude > 80) throw Error('Measured compensation exceeds 80 mm');
    return {
      center,
      rows: pts.map((p, i) => ({ point_id: i + 1, x_px: p.x, y_px: p.y, offset_mm: offsets[i] })),
      curve: { interpolation: 'pchip', amplitude: amplitude || 1, x: pts.map(p => (p.y - pts[0].y) / (pts[pts.length - 1].y - pts[0].y)), y: offsets.map(v => amplitude ? v / amplitude : 0) },
    };
  }
  const api = { defaults, pickedSettings, autoSettings, adjustedSettings, hsv, detect, cylinderScale, measurement, slopes, interpolate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FluixerCalibration = api;
})(typeof window === 'undefined' ? {} : window);

if (typeof window !== 'undefined') window.FluixerCalibration.init = function ({ locked, syncSlider, apply }) {
  const api = window.FluixerCalibration, $ = id => document.getElementById('calibration-' + id);
  const dialog = $('dialog'), canvas = $('photo'), ctx = canvas.getContext('2d');
  const keys = ['sensitivity', 'noise'];
  let baseSettings = { ...api.defaults }, picking = false;
  function setPicking(value) {
    picking = value;
    $('pick-color').textContent = value ? 'Cancel Pick' : 'Pick Color';
    $('pick-color').setAttribute('aria-pressed', String(value));
    $('pick-color').classList.toggle('btn-primary', value);
    $('pick-color').classList.toggle('btn-outline', !value);
    canvas.style.cursor = value ? 'crosshair' : '';
  }
  $('pick-color').addEventListener('click', () => {
    if (locked() || reading || !photo) return;
    setPicking(!picking);
  });
  dialog.addEventListener('close', () => setPicking(false));
  let photo = null, automatic = [], manual = [], scale = null, result = null, timer = null, readId = 0, reading = false;
  function resetParameters() {
    for (const id of keys) {
      $(id).value = 50; $(id + '-slider').value = 50; syncSlider($(id + '-slider'));
    }
  }
  function settings() {
    const values = keys.map(id => {
      const raw = $(id).value, value = Number(raw);
      if (!raw.trim() || !Number.isInteger(value) || value < 0 || value > 100) throw Error('Enter a value from 0 to 100');
      return value;
    });
    return api.adjustedSettings(baseSettings, ...values);
  }
  const points = () => $('mode').value === 'manual' ? manual : automatic;
  function paint() {
    if (!photo) return;
    canvas.width = photo.width; canvas.height = photo.height;
    ctx.putImageData(photo, 0, 0);
    const line = Math.max(1, photo.width / 500);
    ctx.lineWidth = line;
    if (scale) {
      ctx.strokeStyle = '#329962';
      ctx.beginPath(); ctx.moveTo(scale.left, scale.y); ctx.lineTo(scale.right, scale.y); ctx.stroke();
      for (const x of [scale.left, scale.right]) { ctx.beginPath(); ctx.moveTo(x, scale.y - 12); ctx.lineTo(x, scale.y + 12); ctx.stroke(); }
    }
    if (result) {
      ctx.strokeStyle = '#2488cc'; ctx.setLineDash([line * 4, line * 4]);
      ctx.beginPath(); ctx.moveTo(result.center, 0); ctx.lineTo(result.center, photo.height); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = '#ed4141'; ctx.strokeStyle = '#ffffff';
    for (const p of points()) { ctx.beginPath(); ctx.arc(p.x, p.y, line * 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  function refresh() {
    clearTimeout(timer); result = null; scale = null;
    $('apply').disabled = true; $('download').disabled = true;
    $('result').textContent = ''; $('error').textContent = '';
    if (!photo || reading) return;
    try {
      automatic = api.detect(photo.data, photo.width, photo.height, settings());
      const selected = points();
      scale = api.cylinderScale(photo.data, photo.width, photo.height, selected);
      result = api.measurement(selected, scale.mmPerPixel);
      $('result').textContent = `${selected.length} points · 80 mm / ${(scale.right - scale.left).toFixed(1)} px · ±${result.curve.amplitude.toFixed(2)} mm`;
      $('apply').disabled = locked(); $('download').disabled = locked();
    } catch (error) { $('error').textContent = error.message; }
    paint();
    commitPhotoHistory();
  }
  function schedule() {
    clearTimeout(timer); result = null; $('apply').disabled = true; $('download').disabled = true;
    timer = setTimeout(refresh, 120);
  }
  $('open').addEventListener('click', () => {
    if (locked()) return;
    dialog.showModal(); refresh();
  });
  $('close').addEventListener('click', () => dialog.close());
  $('file-open').addEventListener('click', () => { if (!locked() && !reading) $('file').click(); });
  $('file').addEventListener('change', async () => {
    const file = $('file').files[0]; $('file').value = '';
    if (!file || locked()) return;
    const token = ++readId; reading = true; clearTimeout(timer); photo = null; automatic = []; manual = []; scale = null; result = null;
    setPicking(false); $('pick-color').disabled = true;
    canvas.hidden = true; $('apply').disabled = true; $('download').disabled = true;
    $('result').textContent = ''; $('error').textContent = '';
    const url = URL.createObjectURL(file);
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('Photo exceeds 20 MB');
      const image = new Image(); image.src = url; await image.decode();
      if (token !== readId) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw Error('Photo must not exceed 40 megapixels');
      const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const buffer = document.createElement('canvas'); buffer.width = Math.max(1, Math.round(image.naturalWidth * ratio)); buffer.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const g = buffer.getContext('2d'); g.drawImage(image, 0, 0, buffer.width, buffer.height);
      photo = g.getImageData(0, 0, buffer.width, buffer.height);
      baseSettings = api.autoSettings(photo.data, photo.width, photo.height);
      resetParameters();
      $('mode').value = 'auto'; canvas.hidden = false; reading = false; $('pick-color').disabled = false; refresh();
    } catch (error) { if (token === readId) $('error').textContent = error.message || 'Could not decode photo'; }
    finally { URL.revokeObjectURL(url); if (token === readId) reading = false; }
  });
  for (const id of keys) {
    const number = $(id), slider = $(id + '-slider'); syncSlider(slider);
    slider.addEventListener('input', () => { if (locked()) return; number.value = slider.value; syncSlider(slider); schedule(); });
    number.addEventListener('input', () => { if (locked()) return; slider.value = number.value; syncSlider(slider); schedule(); });
  }
  $('parameters-reset').addEventListener('click', () => {
    if (locked() || reading) return;
    resetParameters(); refresh();
  });
  $('mode').addEventListener('change', refresh);
  $('points-clear').addEventListener('click', () => { if (locked()) return; manual = []; $('mode').value = 'manual'; refresh(); });
  canvas.addEventListener('click', event => {
    if (locked() || reading || !photo) return;
    const r = canvas.getBoundingClientRect(), x = (event.clientX - r.left) / r.width * photo.width, y = (event.clientY - r.top) / r.height * photo.height;
    if (picking) {
      try {
        baseSettings = api.pickedSettings(photo.data, photo.width, photo.height, x, y, baseSettings);
        resetParameters(); $('mode').value = 'auto'; setPicking(false); refresh();
      } catch (error) { $('error').textContent = error.message; }
      return;
    }
    if ($('mode').value !== 'manual') return;
    if (event.altKey) {
      let best = -1, distance = 14 * photo.width / r.width;
      manual.forEach((p, i) => { const d = Math.hypot(x - p.x, y - p.y); if (d < distance) { distance = d; best = i; } });
      if (best >= 0) manual.splice(best, 1);
    } else if (manual.length < 256) manual.push({ x, y });
    refresh();
  });
  $('apply').addEventListener('click', () => {
    if (locked() || reading) return;
    refresh();
    if (!result) return;
    apply(result.curve); dialog.close();
  });
  $('download').addEventListener('click', () => {
    if (locked() || reading) return;
    refresh(); if (!result) return;
    const csv = 'point_id,x_px,y_px,offset_mm\r\n' + result.rows.map(r => [r.point_id, r.x_px.toFixed(3), r.y_px.toFixed(3), r.offset_mm.toFixed(6)].join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), link = document.createElement('a');
    link.href = url; link.download = 'fluixer-calibration.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // The photo dialog owns a separate undo stack; applying a curve is one main-project edit.
  function capturePhotoEdit() {
    return { photo, baseSettings: { ...baseSettings }, manual: structuredClone(manual),
      mode: $('mode').value, values: keys.map(id => $(id).value) };
  }
  const photoHistory = new FluixerHistory.History({
    capture: capturePhotoEdit,
    equal: (a, b) => a.photo === b.photo && JSON.stringify({ ...a, photo: null }) === JSON.stringify({ ...b, photo: null }),
    restore: state => {
      ++readId; reading = false; clearTimeout(timer);
      photo = state.photo; baseSettings = { ...state.baseSettings }; manual = structuredClone(state.manual);
      $('mode').value = state.mode;
      keys.forEach((id, index) => { $(id).value = state.values[index]; $(id + '-slider').value = state.values[index]; syncSlider($(id + '-slider')); });
      setPicking(false); $('pick-color').disabled = !photo;
      canvas.hidden = !photo; refresh();
    },
  });
  let photoPointer = null;
  function commitPhotoHistory() { if (!reading && !locked()) photoHistory.checkpoint(); }
  dialog.addEventListener('pointerdown', event => {
    if (event.button !== 0 || reading || locked()) return;
    photoHistory.begin(); photoPointer = event.pointerId;
  }, true);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
    if (event.pointerId !== photoPointer) return;
    photoPointer = null;
    queueMicrotask(() => { photoHistory.held = false; commitPhotoHistory(); });
  });
  window.addEventListener('blur', () => {
    photoPointer = null;
    queueMicrotask(() => { photoHistory.held = false; commitPhotoHistory(); });
  });
  for (const name of ['change', 'click']) dialog.addEventListener(name, () => queueMicrotask(commitPhotoHistory));
  dialog.addEventListener('keydown', event => {
    const action = FluixerHistory.shortcut(event);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat && !reading && !locked()) photoHistory.move(action === 'redo');
  });
};
