const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const R=require('../fluixer/ui/interactive-constraints.js');
const line=Array.from({length:33},(_,i)=>[i*2.5,0,37.5]);
// Screen-space input budget is independent of FPS/zoom; constrained rope
// response may lag the cursor. Never translate the whole rope to erase that lag.
for(const fps of [30,60,120])for(const scale of [.5,1,4,10]) {
  const state=R.create(line,{u:16,pins:[],target:null,collision:false,diameter:4,stiffness:0,screenGrab:true,grabStep:360/fps/scale});
  const first=R.at(state.points,16),goal=[40,0,37.5+1000/scale];
  for(let i=0;i<fps/10;i++)R.step(state,goal);
  const pixels=Math.hypot(...R.at(state.points,16).map((v,k)=>v-first[k]))*scale;
  assert.ok(Math.abs(pixels-36)<.1);
}
for(const scale of [.5,1,4,10])for(const direction of [[0,0,1],[0,1,0]]) {
  const state=R.create(line,{u:16,pins:[],target:80,collision:true,diameter:4,stiffness:.2,screenGrab:true,grabStep:6/scale});
  const first=R.at(state.points,16),goal=first.map((v,k)=>v+direction[k]*50/scale);
  R.step(state,goal);
  const normalMotion=i=>state.points[i].reduce((sum,v,k)=>sum+(v-line[i][k])*direction[k],0);
  assert.ok(normalMotion(16)*scale>1,'grabbed region did not deform');
  for(const i of [0,32])assert.ok(Math.abs(normalMotion(i)*scale)<.001,'ungrabbed ends received a global translation');
  assert.ok(Math.abs(R.length(state.points)-80)<1e-6,'length changed');
  assert.equal(R.collides(state.points,4),false);
}
const source=fs.readFileSync(require('node:path').join(__dirname,'../fluixer/ui/app.js'),'utf8');
const handlers={};let cancelled=0,commits=0;
const changed=line.map(p=>[p[0],p[1],p[2]+1]);
const c={interactiveDrag:{frame:1,collision:true,diameter:4,lastValid:changed,original:line,solver:{},id:null},
 interactivePoints:changed,interactiveTargetLength:80,interactiveTool:null,obstacleEditing:true,
 canvas:{hasPointerCapture:()=>false},interactiveCollides:()=>false,cancelAnimationFrame:()=>cancelled++,
 syncInteractiveControls(){},commitEditHistory(){commits++},scheduleInteractivePreview(){},draw(){},
 selectSidebarTab(){},$:id=>({addEventListener:(type,callback)=>handlers[id]=callback})};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('function acceptInteractiveDrag('),source.indexOf('function cancelInteractiveDrag(')),c);
const a=source.indexOf("for(const tool of ['pin','tension','slack'])");
vm.runInContext(source.slice(a,source.indexOf("for(const id of ['plane-toggle'",a)),c);
handlers['interactive-pin']();
assert.equal(c.interactiveDrag,null);assert.equal(c.interactivePoints,changed);assert.equal(c.interactiveTool,'pin');assert.equal(c.obstacleEditing,false);
assert.equal(commits,1);assert.equal(cancelled,1);
console.log('PASS: screen-space input budget and local deformation without global translation; tool switch commits pending curve.');
