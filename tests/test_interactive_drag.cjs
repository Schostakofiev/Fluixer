const assert=require('node:assert/strict');
const R=require('../fluixer/ui/interactive-constraints.js');
const line=Array.from({length:33},(_,i)=>[i*2.5,0,37.5]);
// Screen-space input budget is independent of FPS/zoom; constrained rope
// response may lag the cursor. Never translate the whole rope to erase that lag.
for(const fps of [30,60,120])for(const scale of [.5,1,4,10]) {
  const state=R.create(line,{u:16,pins:[],target:null,collision:false,diameter:4,stiffness:0,screenGrab:true,grabStep:540/fps/scale});
  const first=R.at(state.points,16),goal=[40,0,37.5+1000/scale];
  for(let i=0;i<fps/10;i++)R.step(state,goal);
  const pixels=Math.hypot(...R.at(state.points,16).map((v,k)=>v-first[k]))*scale;
  assert.ok(Math.abs(pixels-54)<.1);
}
for(const scale of [.5,1,4,10])for(const direction of [[0,0,1],[0,1,0]]) {
  const state=R.create(line,{u:16,pins:[],target:80,collision:true,diameter:4,stiffness:.2,screenGrab:true,grabStep:9/scale});
  const first=R.at(state.points,16),goal=first.map((v,k)=>v+direction[k]*50/scale);
  R.step(state,goal);
  const normalMotion=i=>state.points[i].reduce((sum,v,k)=>sum+(v-line[i][k])*direction[k],0);
  assert.ok(normalMotion(16)*scale>1,'grabbed region did not deform');
  for(const i of [0,32])assert.ok(Math.abs(normalMotion(i)*scale)<.001,'ungrabbed ends received a global translation');
  assert.ok(Math.abs(R.length(state.points)-80)<1e-6,'length changed');
  assert.equal(R.collides(state.points,4),false);
}
console.log('PASS screen-space input budget and local deformation without global translation');
