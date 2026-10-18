/* Fluixer serial adapter. Protocol interoperability only; no device access on page load. */
(function (root) {
  'use strict';
  function crc(text) {
    let value = 0;
    for (const char of text) {
      value ^= char.charCodeAt(0);
      for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ ((value & 128) ? 7 : 0)) & 255;
    }
    return value;
  }
  function frame(command) { return `${command} *${crc(command).toString(16).toUpperCase().padStart(2, '0')}\r\n`; }
  function response(line) {
    const at = line.lastIndexOf(' *');
    if (at >= 0) {
      const checksum = line.slice(at + 2);
      if (!/^[0-9a-f]{2}$/i.test(checksum) || crc(line.slice(0, at)) !== parseInt(checksum, 16)) throw Error('Invalid response checksum');
      line = line.slice(0, at);
    }
    if (/^ERR(?: |$)/.test(line)) throw Error(`Device: ${line}`);
    if (!/^OK(?: |$)/.test(line)) throw Error('Unexpected device response');
    return line.slice(2).trim();
  }
  function parse(source) {
    if (source.length > 4194304) throw Error('CSV exceeds 4 MB');
    const lines = source.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const fields = line => line.split(',').map(v => v.trim().replace(/^"([^"\r\n]*)"$/, '$1'));
    const header = fields(lines.shift());
    const expected = ['type', 'motor', 'direction', 'steps', 'speed', 'unit', 'seconds'];
    if (header.join(',') !== expected.join(',')) throw Error('Expected Fluixer CSV header: ' + expected.join(','));
    const rows = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      const values = fields(line), row = Object.fromEntries(header.map((key, i) => [key, values[i]]));
      const fail = () => { throw Error(`Invalid CSV row ${index + 2}`); };
      if (values.length !== 7) fail();
      if (row.type === 'delay') {
        const seconds = Number(row.seconds);
        if (!row.seconds || !Number.isFinite(seconds) || seconds <= 0 || seconds > 10) fail();
        rows.push({ seconds });
      } else if (row.type === 'move') {
        const count = Number(row.steps), speed = Number(row.speed);
        if (!['g', 'l'].includes(row.motor) || !['fwd', 'rev'].includes(row.direction) ||
            !['steps', 'segments'].includes(row.unit) || !Number.isInteger(count) || count < 1 ||
            count > (row.unit === 'steps' ? 2000 : 89) || !Number.isInteger(speed) || speed < 1 || speed > 625) fail();
        rows.push({ motor: row.motor, direction: row.direction, count, speed, unit: row.unit });
      } else fail();
      if (rows.length > 100000) throw Error('CSV exceeds 100,000 rows');
    }
    if (!rows.length) throw Error('CSV is empty');
    return rows;
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const STOPPED = Symbol('normal stop');
  class Controller {
    constructor(update = () => {}) {
      this.update = update; this.port = null; this.ready = false; this.running = false;
      this.paused = false; this.pending = null; this.stopping = false;
    }
    rejectPending(error) { if (this.pending) this.pending.reject(error); }
    async connect(serial) {
      if (this.port) throw Error('Already connected');
      this.port = await serial.requestPort();
      try {
        await this.port.open({ baudRate: 115200 });
        this.writer = this.port.writable.getWriter(); this.reader = this.port.readable.getReader();
        this.readTask = this.read();
        await sleep(2000); // Arduino resets when opening its port.
        this.version = await this.command('VER', 2000);
        if (!this.version) throw Error('Device did not return a firmware version');
        this.ready = true;
      } catch (error) { await this.disconnect(); throw error; }
    }
    async read() {
      const decoder = new TextDecoder(); let buffer = '';
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 16384) throw Error('Device response too large');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
            if (line.startsWith('#RESET') && this.ready) throw Error('Device reset; reconnect required');
            if (!/^(OK|ERR)(?: |$)/.test(line)) continue;
            if (this.pending) {
              try { this.pending.resolve(response(line)); } catch (error) { this.pending?.reject(error); }
            }
          }
        }
        if (!this.closing) throw Error('Serial device disconnected');
      } catch (error) {
        this.ready = false; this.running = false; this.rejectPending(error);
        if (!this.closing) this.update(error.message);
      }
    }
    command(text, timeout) {
      if (!this.writer || this.pending) return Promise.reject(Error('Serial channel unavailable'));
      return new Promise((resolve, reject) => {
        const finish = (fn, value) => { clearTimeout(timer); this.pending = null; fn(value); };
        const timer = setTimeout(() => finish(reject, Error('Device response timed out; reconnect required')), timeout);
        this.pending = { resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
        this.writer.write(new TextEncoder().encode(frame(text))).catch(error => this.pending?.reject(error));
      });
    }
    async disconnect() {
      this.closing = true; this.ready = false; this.running = false; this.paused = false;
      this.rejectPending(Error('Disconnected'));
      try { await this.reader?.cancel(); await this.readTask; } catch (_) { /* unplugged */ }
      try { this.reader?.releaseLock(); } catch (_) { /* already released */ }
      try { this.writer?.releaseLock(); } catch (_) { /* already released */ }
      try { await this.port?.close(); } catch (_) { /* unplugged */ }
      this.reader = null; this.writer = null; this.port = null; this.closing = false;
    }
    stop() {
      if (!this.running || this.stopping) return;
      this.stopRequested = true;
      this.stopping = true;
      this.paused = false;
      this.update();
    }
    async emergencyStop() {
      if (this.emergencyStopping) return;
      this.emergencyStopping = true;
      this.stopping = true; this.running = false; this.ready = false; this.paused = false;
      this.rejectPending(Error('Emergency stop requested'));
      try {
        if (this.writer) await this.writer.write(new TextEncoder().encode(frame('ESTP')));
        this.update('Emergency stop sent; reconnect required');
      } catch (_) { this.update('Stop could not be sent. Check device / use hardware stop.'); }
      finally { await this.disconnect(); this.stopping = false; this.emergencyStopping = false; this.update(); }
    }
    async gate() {
      while (this.running && this.paused && !this.stopRequested) await sleep(30);
      if (this.stopRequested) throw STOPPED;
      if (!this.running) throw Error('Execution stopped');
    }
    async run(rows, progress) {
      if (!this.ready || this.running) throw Error('Connect before running');
      this.stopRequested = false; this.running = true; this.paused = false; this.update('Running');
      try {
        for (let i = 0; i < rows.length; i++) {
          await this.gate(); const row = rows[i];
          if ('seconds' in row) {
            let remaining = row.seconds * 1000;
            while (remaining > 0) {
              await this.gate(); const duration = Math.min(30, remaining);
              await sleep(duration); remaining -= duration;
            }
          } else {
            const steps = row.unit === 'segments' ? Array.from({ length: row.count }, (_, n) => [67, 67, 66][n % 3]) : [row.count];
            for (const amount of steps) {
              await this.gate();
              await this.command(`MOV 1 ${row.motor} ${row.direction} ${amount} ${row.speed}`, Math.max(5000, Math.ceil(amount / row.speed * 1500) + 1000));
            }
          }
          await this.gate(); progress(i + 1, rows.length);
        }
        this.update('Complete');
      } catch (error) {
        if (error !== STOPPED && !this.emergencyStopping) { this.update(error.message); await this.emergencyStop(); }
      } finally { this.running = false; this.paused = false; this.stopping = false; this.stopRequested = false; this.update(); }
    }
  }
  const api = { crc, frame, response, parse, Controller };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FluixerSerial = api;
})(typeof window === 'undefined' ? {} : window);

if (typeof window !== 'undefined') FluixerSerial.init = function ({ state, source, changed }) {
  const $ = id => document.getElementById('serial-' + id);
  let busy = false;
  const controller = new FluixerSerial.Controller(message => {
    if (message && !/^(Running|Complete|Emergency stop sent)/.test(message)) showError(message);
    sync();
  });
  function showError(message = '') {
    $('status').textContent = message; $('status').hidden = !message;
  }
  function sync() {
    const current = state(), active = busy || controller.running || controller.stopping;
    $('connect').textContent = controller.port ? 'Disconnect' : 'Connect';
    $('connect').disabled = active;
    $('generated').hidden = current.imported;
    $('start').hidden = !current.imported;
    for (const id of ['start', 'compensated', 'original']) $(id).disabled = active || !current.available || !controller.ready;
    $('pause').disabled = !controller.running || controller.stopping;
    const label = controller.paused ? 'Resume' : 'Pause after current command';
    $('pause').title = label; $('pause').setAttribute('aria-label', label);
    $('pause').setAttribute('aria-pressed', String(controller.paused));
    $('pause-symbol').setAttribute('d', controller.paused ? 'm8 5 11 7-11 7Z' : 'M8 5v14M16 5v14');
    $('stop').disabled = !controller.running || controller.stopping;
    if (active) {
      document.getElementById('csv-import').disabled = true;
      document.getElementById('csv-preview-clear').disabled = true;
    }
  }
  FluixerSerial.refresh = sync;
  $('connect').addEventListener('click', async () => {
    showError();
    if (!navigator.serial) { showError('Use Chrome or Edge over HTTPS / localhost to connect'); return; }
    busy = true; sync();
    try {
      if (controller.port) await controller.disconnect();
      else await controller.connect(navigator.serial);
    } catch (error) { showError(error.message); }
    finally { busy = false; changed(); }
  });
  async function run(compensated) {
    if (busy || !state().available || !controller.ready || controller.running) return;
    busy = true; showError(); $('progress').value = 0; sync();
    try {
      // Capture the export payload / imported file once; UI edits never mutate an active job.
      const rows = FluixerSerial.parse(await source(compensated));
      $('progress').max = rows.length;
      await controller.run(rows, (done, total) => { $('progress').max = total; $('progress').value = done; });
    } catch (error) { showError(error.message); }
    finally { busy = false; changed(); }
  }
  $('compensated').addEventListener('click', () => run(true));
  $('original').addEventListener('click', () => run(false));
  $('start').addEventListener('click', () => run(false));
  $('pause').addEventListener('click', () => { controller.paused = !controller.paused; sync(); });
  $('stop').addEventListener('click', () => controller.stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden && controller.running) controller.emergencyStop(); });
  window.addEventListener('pagehide', () => { if (controller.running) controller.emergencyStop(); });
  sync();
};
