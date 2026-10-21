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
// Automatic selection adapts to each photo without manual picking.
function stripes(rgb, background=[210,210,210], distractor=null) {
  const w=240,h=180,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let color=distractor&&x<85?distractor:background;
    for(let row=0;row<4;row++)if(x>=110&&x<205&&y>=30+row*32&&y<40+row*32)
      color=rgb.map(v=>Math.round(v*(1-row*.12)));
    data.set([...color,255],(y*w+x)*4);
  }
  return {w,h,data};
}
for(const rgb of [[240,15,15],[240,15,30],[15,60,240],[15,220,60],[240,220,15],[230,30,190],[20,210,210],[230,100,15],[15,30,95]]){
  const {w,h,data}=stripes(rgb),base=api.autoSettings(data,w,h),points=api.detect(data,w,h,base);
  assert.equal(points.length,4,`automatic color ${rgb}`);
  assert(points.every(p=>p.x===204),'right endpoints retained');
  assert(points.every((p,i)=>!i||p.y>points[i-1].y),'ordered top to bottom');
}
const scene=stripes([20,60,230],[200,200,200],[40,210,40]);
const auto=api.autoSettings(scene.data,scene.w,scene.h);
assert.equal(api.detect(scene.data,scene.w,scene.h,auto).length,4,'repeated liquid rows beat a larger colored background');
assert.equal(api.detect(photo([220,220,220]),20,20,api.autoSettings(photo([220,220,220]),20,20)).length,0,'neutral photo does not invent a color');
console.log('PASS: automatic red, blue, green, yellow, purple, cyan, orange, dark blue, shading and colored background rejection.');
