const assert=require('node:assert/strict');
const c=require('../fluixer/ui/interactive-constraints.js');
const line=Array.from({length:33},(_,i)=>[i*2.5,0,0]);
const options={target:80,pins:[],u:16,diameter:4,collision:true};
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
assert(Math.abs(c.length(line)-80)<1e-9);
let state=c.create(line,options);
console.time('rope tests');
for(let i=0;i<100;i++){
  c.step(state,[40,0,30]);
  assert(Math.abs(c.length(state.points)-80)<1e-6,'locked arc length');
  assert(!c.collides(state.points,4),'collision-free long pull');
}
assert(distance(c.at(state.points,16),[40,0,30])<.02,'stationary mouse must keep pulling until reached');
assert(state.points[0][0]>10&&state.points.at(-1)[0]<70,'length constraints propagate to free endpoints');
for(let i=0;i<80;i++)c.step(state,null);
assert(state.speed<.001,'released rope settles');
const settled=structuredClone(state.points);
for(let i=0;i<10;i++)c.step(state,null);
assert(distance(state.points[16],settled[16])<.01,'no release drift');
const pinned=c.create(line,{...options,pins:[0,32]});
for(let i=0;i<10;i++)c.step(pinned,[40,0,20]);
assert.deepEqual(pinned.points,line,'taut fixed rope cannot bend');
const slack=line.map((p,i)=>[p[0],0,12*Math.sin(i/32*Math.PI)]);
state=c.create(slack,{...options,target:c.length(slack),pins:[0,32]});
for(let i=0;i<100;i++)c.step(state,[40,15,20]);
assert.deepEqual(state.points[0],slack[0]);assert.deepEqual(state.points.at(-1),slack.at(-1));
assert(Math.abs(c.length(state.points)-c.length(slack))<1e-6);
assert(distance(state.points[16],slack[16])>1,'slack fixed rope deforms');
const overpass=Array.from({length:65},(_,i)=>{const t=-1.5*Math.PI+i/64*2*Math.PI;return [30*Math.sin(t),10*t,20*Math.sin(2*t)];});
assert(!c.collides(overpass,4),'spatially separated crossings are permitted');
state=c.create(overpass,{...options,target:c.length(overpass)});
for(let i=0;i<160;i++){
  c.step(state,[0,20,0]);
  assert(!c.collides(state.points,4),'capsule contacts stay separated during a fast spatial pull');
}
const crossing=overpass.map(p=>[p[0],0,p[2]]);crossing.at(-1)[0]+=.1;
assert(c.collides(crossing,4));
state=c.create(crossing,{...options,target:c.length(crossing)});
for(let i=0;i<120;i++)c.step(state,null);
assert(!c.collides(state.points,4),'overlapping parts are pushed apart rather than locking the editor');
const tight=Array.from({length:33},(_,i)=>[Math.cos(i/32*Math.PI),0,Math.sin(i/32*Math.PI)]);
assert(!c.collides(tight,4),'curvature alone is not a nonlocal collision');
state=c.create(line,{...options,target:null});
for(let i=0;i<80;i++)c.step(state,[40,10,20]);
assert(c.length(state.points)>90,'unlocked rope can stretch');
console.timeEnd('rope tests');
console.log('PASS: continuous pull, endpoints, damping, length, 3D contacts, collision recovery, unlocked length.');

// Length is added at the tail, never through a global shape scale.
for(const value of [81,120,1000,50,10]) {
 const resized=c.resize(line,value,[]);
 assert(Math.abs(c.length(resized)-value)<.01);
 if(value>80)assert.deepEqual(resized.slice(0,line.length),line);
}
const endPinned=c.resize(line,120,[32]);assert.deepEqual(endPinned[32],line[32]);
const clipped=c.resize(line,20,[24]);assert(Math.abs(c.length(clipped)-60)<1e-7);assert.deepEqual(clipped[24],line[24]);
state=c.create(line,{...options,pins:[8,16],u:24});
for(let i=0;i<80;i++)c.step(state,[60,0,15]);
assert.deepEqual(state.points[8],line[8]);assert.deepEqual(state.points[16],line[16]);
assert(state.points[24][2]>1);assert(Math.abs(c.length(state.points)-80)<1e-6);
console.log('PASS: endpoint extension, tail trimming, pin boundary and interior anchors.');

// Tightening changes only the selected interval and preserves its anchors.
const arches=Array.from({length:65},(_,i)=>[i*2.5,0,12*Math.sin(i/64*4*Math.PI)]);
const tightened=c.createTension(arches,{...options,pins:[0,32,64],u:16,target:c.length(arches),stiffness:.2});
const oldLength=c.length(arches);
for(let i=0;i<180;i++){c.step(tightened,null);assert(!c.collides(tightened.points,4));}
assert(c.length(tightened.points)<oldLength-.1);
assert.deepEqual(tightened.points[0],arches[0]);
assert.deepEqual(tightened.points.slice(32),arches.slice(32));
assert(Math.abs(tightened.spanEdit.target-tightened.spanEdit.desired)<1e-8);
assert.doesNotThrow(()=>c.createTension(arches,{...options,pins:[0,32],u:48}));
assert.throws(()=>c.createTension(line,{...options,pins:[0,32],u:16}));
function maximumTurn(points){let result=0;for(let i=1;i<points.length-1;i++){
 const a=points[i].map((v,k)=>v-points[i-1][k]),b=points[i+1].map((v,k)=>v-points[i][k]);
 const dot=a.reduce((s,v,k)=>s+v*b[k],0)/(Math.hypot(...a)*Math.hypot(...b));
 result=Math.max(result,Math.acos(Math.max(-1,Math.min(1,dot))));}return result;}
const turns=[0,.2,1].map(stiffness=>{const rope=c.create(line,{...options,stiffness,target:80});
 for(let i=0;i<120;i++)c.step(rope,[40,0,20]);
 assert(Math.abs(c.length(rope.points)-80)<1e-6);assert(!c.collides(rope.points,4));
 return maximumTurn(rope.points);});
assert(turns[0]>turns[1]&&turns[1]>turns[2]);
console.log('PASS: isolated tension, fixed anchors, taut boundaries and stiffness response.');

for(const source of [line,arches]) {
 const pins=source===line?[0,32]:[0,32,64];
 const loosened=c.createSlack(source,{...options,pins,u:16,target:c.length(source),stiffness:.2});
 for(let i=0;i<180;i++){c.step(loosened,null);assert(!c.collides(loosened.points,4));}
 assert(c.length(loosened.points)>c.length(source)+.1);
 assert.deepEqual(loosened.points[0],source[0]);
 assert.deepEqual(loosened.points.slice(32),source.slice(32));
 assert(Math.abs(loosened.spanEdit.target-loosened.spanEdit.desired)<1e-6);
 const tightenedAgain=c.createTension(loosened.points,{...options,pins,u:16,target:c.length(loosened.points)});
 for(let i=0;i<180;i++)c.step(tightenedAgain,null);
 assert(c.length(tightenedAgain.points)<c.length(loosened.points));
}
assert.doesNotThrow(()=>c.createSlack(line,{...options,pins:[0],u:16}));
console.log('PASS: slack on straight/curved spans, fixed pins, isolated edits, contacts and reverse tightening.');

// A selected pin follows one axis; all other pins remain fixed.
for(const axis of [0,1,2]) {
 const rope=c.create(arches,{...options,target:c.length(arches),u:32,pins:[0,64],pinAxis:{index:32,axis},stiffness:.2});
 const goal=arches[32].map((v,k)=>v+(k===axis?5:0));
 for(let i=0;i<180;i++)c.step(rope,goal);
 assert(Math.abs(rope.points[32][axis]-arches[32][axis])>1);
 for(let k=0;k<3;k++)if(k!==axis)assert.equal(rope.points[32][k],arches[32][k]);
 assert.deepEqual(rope.points[0],arches[0]);assert.deepEqual(rope.points[64],arches[64]);
 assert(Math.abs(c.length(rope.points)-c.length(arches))<1e-6);
 assert(!c.collides(rope.points,4));
}
console.log('PASS: axis-constrained pin motion, fixed neighboring pins and conserved length.');

for(const create of [c.createTension,c.createSlack]) {
 const rope=create(arches,{...options,target:c.length(arches),pins:[0,32,64],u:16});
 const t=rope.spanEdit;
 c.setSpanDuration(rope,0);assert.equal(t.desired,t.initial);
 c.setSpanDuration(rope,.1);const short=t.desired;
 c.setSpanDuration(rope,1);const long=t.desired;
 assert(t.loosen?long>short:long<short);
 c.setSpanDuration(rope,2);const once=t.desired;
 for(let i=0;i<=120;i++)c.setSpanDuration(rope,i/60);
 assert.equal(t.desired,once,'duration is independent of frame rate');
 for(let i=0;i<180;i++)c.step(rope,null);
 assert.equal(t.desired,once,'settling does not extend the held duration');
 assert(t.desired>=t.chord&&t.desired<=t.limit);
}
console.log('PASS: duration-scaled edits, frame-rate independence and fixed release target.');

for(const pins of [[],[0],[16]])for(const create of [c.createTension,c.createSlack]) {
 const rope=create(line,{...options,pins,u:24});
 c.setSpanDuration(rope,1);
 for(let i=0;i<180;i++)c.step(rope,null);
 assert(create===c.createSlack?c.length(rope.points)>80:c.length(rope.points)<80);
 for(const pin of pins)assert.deepEqual(rope.points[pin],line[pin]);
 if(pins.includes(16))assert.deepEqual(rope.points.slice(0,17),line.slice(0,17));
 assert(!c.collides(rope.points,4));
}
console.log('PASS: unpinned edits, free-end edits, retained pins and unaffected external span.');
// The screen-space grab cap should not change with zoom or camera orientation.
for(const scale of [.5,1,4,10])for(const direction of [[1,0,0],[0,1,0],[0,0,1],[.6,0,.8]]){
  const s=c.create(line,{...options,target:null,collision:false,stiffness:0,grabStep:2/scale});
  const start=c.at(s.points,16),goal=start.map((v,k)=>v+direction[k]*100/scale);
  c.step(s,goal);
  const travel=distance(start,c.at(s.points,16))*scale;
  assert(Math.abs(travel-2)<.01,'screen-space grab speed must be independent of zoom and direction');
}
console.log('PASS: screen-space drag rate across scales and viewing directions.');
