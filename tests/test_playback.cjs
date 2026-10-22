const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('fluixer/ui/app.js', 'utf8');
const controls = new Map();
const context = vm.createContext({
  $: id => {
    if (!controls.has(id)) controls.set(id, {value: '1', disabled: false, addEventListener(type, fn) { this[type] = fn; }});
    return controls.get(id);
  },
  window: {requestAnimationFrame: () => 1},
  document: {addEventListener() {}},
  syncPlayback() {}, syncPlaybackProgress() {}, draw() {},
});
vm.runInContext(`let animationFrame=null,animationTime=0,animationPlaying=true,animationLoop=false,animationProgress=.99,display={},projectBusy=false,previewLoading=false;
function stopAnimation(){animationPlaying=false;animationTime=null;animationFrame=null;}
` + source.slice(source.indexOf('function animationTick(time)'), source.indexOf('\nconst status =')), context);
const run = code => vm.runInContext(code, context);
run('animationTick(400)');
assert.equal(run('animationProgress'), 1);
assert.equal(run('animationPlaying'), false);
run("$('playback-loop').click(); $('playback-play').click(); animationTick(1000); animationTick(41500)");
assert.equal(run('animationPlaying'), true);
assert.ok(Math.abs(run('animationProgress')-3.025)<1e-10);
run("$('playback-play').click()");
assert.equal(run('animationPlaying'), false);
run("$('playback-progress').value='450'; $('playback-progress').input()");
assert.equal(run('animationProgress'), .45);
run("$('playback-final').click()");
assert.equal(run('animationPlaying'), false);
assert.equal(run('animationProgress'), 1);
run("$('playback-play').click(); animationTick(0); $('playback-loop').click(); animationTick(25000)");
assert.equal(run('animationPlaying'), false);
assert.equal(run('animationProgress'), 1);
console.log('PASS: single playback, repeated cycles, pause, scrubbing, final distribution, loop disabled.');

vm.runInContext(source.slice(source.indexOf('function csvPreviewWindows('), source.indexOf('// CSV_PREVIEW_CORE_END')) +
  source.slice(source.indexOf('function movingWindows('), source.indexOf('function motionGeometry(')), context);
const windows = (progress, repeat = true) => JSON.parse(run(`JSON.stringify(movingWindows([
  {phase:'gas',length:2},{phase:'liquid',length:3},{phase:'gas',length:5}
],10,${progress},${repeat}))`));
assert.deepEqual(windows(1), [[2,5]]);
// The old liquid moves forward, while a new liquid enters at the inlet.
assert.deepEqual(windows(1.2), [[0,1],[3,6]]);
assert.deepEqual(windows(2), [[2,5],[7,10]]);
assert.deepEqual(windows(2.2), [[0,1],[3,6],[8,10]]);
assert.deepEqual(windows(1.2,false), [[2,5]]);
assert.deepEqual(windows(1000000.2), windows(2.2));
assert.deepEqual(windows(0), []);
assert.deepEqual(JSON.parse(run(`JSON.stringify(movingWindows([{phase:'gas',length:10}],10,3,true))`)), []);
const before = windows(.999999), after = windows(1.000001);
assert.ok(Math.abs(before[0][1]-after[after.length-1][1]) < .00002);
console.log('PASS: continuous transport across cycles, simultaneous old/new pattern, outlet clipping, bounded long-running repetition, empty pattern.');
