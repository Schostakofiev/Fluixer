const assert = require('node:assert/strict');
const api = require('../fluixer/ui/visual-calibration.js');
function photo(rgb) {
  const data = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < 400; i++) data.set([...rgb, 255], i * 4);
  return data;
}
for (const rgb of [[255,0,0],[255,0,10],[0,0,255],[0,255,0],[255,255,0]]) {
  const data = photo(rgb), settings = api.pickedSettings(data,20,20,10,10);
  assert.equal(api.detect(data,20,20,settings).length,1);
}
const red = api.pickedSettings(photo([255,0,10]),20,20,10,10);
assert.equal(api.detect(photo([255,10,0]),20,20,red).length,1, 'red hue wraps');
assert.equal(api.detect(photo([0,0,255]),20,20,red).length,0);
assert.throws(()=>api.pickedSettings(photo([255,255,255]),20,20,10,10));
assert.equal(api.detect(photo([0,0,255]),20,20).length,0,'yellow default unchanged');
assert(api.adjustedSettings(red,100).hRadius > red.hRadius);
console.log('PASS: picked colors, hue wrap, background rejection, sensitivity, default.');
