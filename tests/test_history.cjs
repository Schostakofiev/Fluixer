const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {History, shortcut} = require('../fluixer/ui/history.js');
let value=0, scope=null;
const h=new History({capture:()=>value,restore:v=>value=v,scope:()=>scope});
h.begin(); for(let i=1;i<=20;i++){value=i;h.checkpoint();} h.end();
assert.equal(h.undo.length,1); h.move(); assert.equal(value,0); h.move(true); assert.equal(value,20);
h.move(); value=7;h.checkpoint(); assert.equal(h.redo.length,0);
const csv={}; scope=csv; assert.equal(h.move(),false); value=9;h.checkpoint();h.move();assert.equal(value,7);assert.equal(h.move(),false);
scope=null;h.move();assert.equal(value,0);
h.reset();for(let i=1;i<=105;i++){value=i;h.checkpoint();}assert.equal(h.undo.length,100);for(let i=0;i<100;i++)h.move();assert.equal(value,5);
h.reset();assert.equal(h.move(),false);
for(const [key,shift,expected] of [['z',false,'undo'],['z',true,'redo'],['y',false,'redo']]) {
 assert.equal(shortcut({ctrlKey:true,key,shiftKey:shift,target:{closest:()=>null}}),expected);
 assert.equal(shortcut({ctrlKey:true,key,shiftKey:shift,target:{closest:()=>({})}}),null);
}
const app=fs.readFileSync(require('node:path').join(__dirname,'../fluixer/ui/app.js'),'utf8');
const tail=app.slice(app.indexOf('// Model edits have their own snapshots;'));
const elements={},events={};
const element=id=>elements[id]??={value:'1',checked:false,style:{},addEventListener(){}};
const c={structuredClone,FluixerHistory:{History,shortcut},editHistory:null,imageHistoryPending:0,projectBusy:false,csvReading:false,importedCsv:null,stepBusy:false,exporting:false,
 tubeNames:['radius','height','diameter','wind'],$:element,curveState:{amplitude:0,x:[0,1],y:[0,0]},tubeCenter:[0,0,0],placement:{position:[0,0,0]},initialPlacement:{position:[0,0,0]},tubeStepSource:null,tubeStepReverse:false,innerDiameter:2,
 brushPixels:new Uint8Array(4),brushActive:null,spatialWindows:[],stepActive:null,stepPlacement:null,imageActive:null,imageRaster:{data:new Uint8Array([3])},imagePhoto:null,imagePhotoSource:'source',
 requestId:0,imageReadId:0,imageProcessId:0,stepReadId:0,tubeStepReadId:0,imagePhotoPending:null,tubeKind:'cylinder',selectedPoint:null,stepDraft:null,canvas:{style:{}},
 clonePlane:structuredClone, setCurve(v){c.curveState=v;element('curve-amplitude').value=String(v.amplitude);},tubeLabels(){},paintBrush(){},paintImage(){},syncRenderControls(){},syncPlaneTools(){},syncSliderFill(){},
 loadDisplay(){c.requestId++;c.commitEditHistory();},queueMicrotask:f=>f(),
 document:{querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(n,f)=>events[n]=f},window:{addEventListener(){}},
 yaw:0.4,planeVisible:false,animationProgress:.3};
element('curve-amplitude').value='0';element('tube-type').value='cylinder';element('pattern-type').value='image';
vm.createContext(c);vm.runInContext(tail,c);
element('tube-radius').value='50';c.commitEditHistory();assert.equal(c.editHistory.undo.length,1);
c.moveEditHistory();assert.equal(element('tube-radius').value,'1');assert.equal(c.yaw,.4);assert.equal(c.planeVisible,false);assert.equal(c.animationProgress,.3);
c.moveEditHistory(true);assert.equal(element('tube-radius').value,'50');
const raster=c.imageRaster;c.imageActive={source:'changed'};c.brushPixels[0]=1;c.commitEditHistory();c.moveEditHistory();assert.equal(c.imageActive,null);assert.equal(c.brushPixels[0],0);assert.equal(c.imageRaster,raster);
c.moveEditHistory(true);assert.equal(c.brushPixels[0],1);
// Old computation must not commit while an undo-triggered request is queued.
assert(app.includes('if (current !== requestId) return;'));
assert(app.includes('if (!editHistory?.restoring) followTubeResize();'));
console.log('PASS: grouping, redo invalidation, 100-step cap, CSV boundary, keyboard routing, state restoration, image retention, view preservation.');
