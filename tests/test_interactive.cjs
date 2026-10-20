const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../fluixer/ui/app.js'),'utf8');
const c={};vm.createContext(c);
vm.runInContext(src.slice(src.indexOf('function defaultInteractivePoints()'),src.indexOf('function drawInteractiveCurve(')),c);
const points=c.defaultInteractivePoints();
c.validateInteractivePoints(points);
assert.throws(()=>c.validateInteractivePoints([[0,0,0],[1,0,0],[0,0,0]]));
assert.equal(c.interactiveSamples(points).length,257);
console.log('PASS: open points and interpolation samples.');
