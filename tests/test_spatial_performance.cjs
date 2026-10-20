const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../fluixer/ui/app.js'),'utf8');
// Frozen pre-optimization implementation for output equivalence checks.
const old="function mergeSpatial(windows) {\n  const result = [];\n  for (const w of windows.sort((a, b) => a[0] - b[0])) {\n    const last = result[result.length - 1];\n    if (last && w[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], w[1]);\n    else result.push(w.slice());\n  }\n  return result;\n}\nfunction spatialStamp(x, y, stroke) {\n  const { map, radius } = stroke,\n    windows = [];\n  for (\n    let row = Math.max(0, Math.floor((y - radius) / map.cell));\n    row <= Math.min(map.height - 1, Math.ceil((y + radius) / map.cell));\n    row++\n  )\n    for (\n      let col = Math.max(0, Math.floor((x - radius) / map.cell));\n      col <= Math.min(map.width - 1, Math.ceil((x + radius) / map.cell));\n      col++\n    ) {\n      if (Math.hypot((col + 0.5) * map.cell - x, (row + 0.5) * map.cell - y) > radius) continue;\n      const u = map.hits[row * map.width + col];\n      if (u >= 0) windows.push([Math.max(0, u - map.pad), Math.min(1, u + map.pad)]);\n    }\n  const marks = mergeSpatial(windows);\n  if (spatialErase) {\n    for (const [a, b] of marks)\n      spatialWindows = spatialWindows.flatMap(([lo, hi]) =>\n        hi <= a || lo >= b\n          ? [[lo, hi]]\n          : [...(lo < a ? [[lo, a]] : []), ...(hi > b ? [[b, hi]] : [])],\n      );\n  } else spatialWindows = mergeSpatial([...spatialWindows, ...marks]);\n}\nfunction syncSpatialControls() {}";
function context(src,modern){
 const c={spatialWindows:[],spatialErase:false};vm.createContext(c);
 const start=src.indexOf('function mergeSpatial('),end=src.indexOf('function syncSpatialControls()',start);
 vm.runInContext(src.slice(start,end),c);return c;
}
const oldCtx=context(old),newCtx=context(source);
const map={cell:2,width:180,height:120,pad:.00004,hits:Float64Array.from({length:21600},(_,i)=>i%5===0?-1:i/21600)};
map.depths=new Float64Array(map.hits.length);map.scale=1;map.diameter=4;
const positions=Array.from({length:150},(_,i)=>[140+Math.sin(i/20)*50,100+Math.cos(i/20)*35]);
for(const erase of [false,true]){
 const initial=erase?[[0,.2],[.3,.6],[.7,1]]:[];
 oldCtx.spatialWindows=structuredClone(initial);newCtx.spatialWindows=structuredClone(initial);oldCtx.spatialErase=erase;
 const a={map,radius:25},b={map,radius:25};
 const before=performance.now();for(const [x,y] of positions)oldCtx.spatialStamp(x,y,a);const oldTime=performance.now()-before;
 const after=performance.now();for(let i=0;i<positions.length;i+=5){const marks=[];for(const [x,y] of positions.slice(i,i+5))newCtx.spatialStamp(x,y,b,marks);newCtx.applySpatialMarks(marks,erase)}const newTime=performance.now()-after;
 assert.deepEqual(JSON.parse(JSON.stringify(newCtx.spatialWindows)),JSON.parse(JSON.stringify(oldCtx.spatialWindows)));
 assert.equal(newCtx.spatialStamp(...positions.at(-1),b).length,0);
 console.log(`${erase?'erase':'paint'}: equal results, old ${oldTime.toFixed(1)}ms / new ${newTime.toFixed(1)}ms`);
}
let frame, timer, loads=0;
newCtx.$=()=>({value:'spatial-brush'});newCtx.importedCsv=null;newCtx.projectBusy=false;newCtx.previewLoading=true;
newCtx.requestAnimationFrame=f=>{frame=f;return 1};newCtx.setTimeout=f=>{timer=f;return 2};newCtx.loadDisplay=()=>loads++;
newCtx.scheduleSpatialRefresh();newCtx.scheduleSpatialRefresh();frame();assert.equal(loads,0);
newCtx.previewLoading=false;timer();assert.equal(loads,1);
console.log('PASS: coalesced refresh waits for active response.');

// Rear hits remain visible through a narrow screen gap, but are not brush targets.
const layered={cell:2,width:5,height:1,pad:.001,scale:1,diameter:2,
 hits:new Float64Array([.1,.2,.8,.3,.4]),depths:new Float64Array([0,0,40,0,0])};
const stroke={map:layered,radius:6};
let marks=newCtx.spatialStamp(5,1,stroke);
assert.equal(marks.length,4);
assert.ok(marks.every(w=>w[1]<.5));
assert.equal(newCtx.spatialStamp(5,1,stroke).length,0,'visited foreground still blocks rear');
// A deliberately isolated rear target is reachable once the brush leaves foreground.
const small={map:layered,radius:.9};
assert.equal(newCtx.spatialStamp(5,1,small).length,1);
// The depth band follows a sloping front surface rather than exact depth equality.
layered.depths.set([0,1,40,2,1]);
assert.equal(newCtx.spatialStamp(5,1,{map:layered,radius:6}).length,4);
console.log('PASS: foreground footprint blocks gap leakage and permits isolated rear targets.');
