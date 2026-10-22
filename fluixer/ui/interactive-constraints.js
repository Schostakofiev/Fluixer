(function(root) {
  'use strict';
  const nodes=[0,-.5384693101056831,.5384693101056831,-.906179845938664,.906179845938664];
  const weights=[.5688888888888889,.4786286704993665,.4786286704993665,.2369268850561891,.2369268850561891];
  const sub=(a,b)=>a.map((v,k)=>v-b[k]);
  const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
  const norm=v=>Math.hypot(...v);
  const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
  const clamp=t=>Math.max(0,Math.min(1,t));

  // The same Hermite curve and quadrature as interactive.py. Constraint
  // derivatives distribute corrections to particles instead of scaling the shape.
  function basis(count,u,derivative=false) {
    const i=Math.min(count-2,Math.floor(u)),t=u-i,t2=t*t;
    const h=derivative ? [6*t2-6*t,3*t2-4*t+1,-6*t2+6*t,3*t2-2*t]
      : [2*t2*t-3*t2+1,t2*t-2*t2+t,-2*t2*t+3*t2,t2*t-t2];
    const b=new Map(),add=(j,w)=>b.set(j,(b.get(j)||0)+w);
    add(i,h[0]);add(i+1,h[2]);
    if(i){add(i-1,-h[1]/2);add(i+1,h[1]/2);}
    else {add(i,-h[1]);add(i+1,h[1]);}
    if(i<count-2){add(i,-h[3]/2);add(i+2,h[3]/2);}
    else {add(i,-h[3]);add(i+1,h[3]);}
    return [...b].filter(([,w])=>Math.abs(w)>1e-15);
  }
  function evaluate(points,b) {
    let x=0,y=0,z=0;
    for(let j=0;j<b.length;j++){const [i,w]=b[j],p=points[i];x+=p[0]*w;y+=p[1]*w;z+=p[2]*w;}
    return [x,y,z];
  }
  const at=(points,u)=>evaluate(points,basis(points.length,u));
  const quadratureCache=new Map();
  function quadrature(count) {
    if(!quadratureCache.has(count))quadratureCache.set(count,
      Array.from({length:count-1},(_,i)=>nodes.map((n,j)=>({b:basis(count,i+(n+1)/2,true),w:weights[j]/2}))));
    return quadratureCache.get(count);
  }
  function measure(points,q,gradient=false) {
    let value=0;const sums=gradient?[]:null,gradients=[];
    for(let j=0;j<q.length;j++){
      const {b,w}=q[j];let x=0,y=0,z=0;
      for(let n=0;n<b.length;n++){const [i,c]=b[n],p=points[i];x+=p[0]*c;y+=p[1]*c;z+=p[2]*c;}
      const speed=Math.hypot(x,y,z);value+=speed*w;
      if(gradient&&speed>1e-12)for(let n=0;n<b.length;n++){
        const [i,c]=b[n];let g=sums[i];
        if(!g){g=sums[i]=[0,0,0];gradients.push([i,g]);}
        g[0]+=w*c*x/speed;g[1]+=w*c*y/speed;g[2]+=w*c*z/speed;
      }
    }
    return {value,gradients};
  }
  function length(points){return quadrature(points.length).reduce((s,q)=>s+measure(points,q).value,0);}
  function closest(a,b,c,d) {
    const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);
    let s=0,t=0;
    if(aa<1e-20)t=cc?clamp(ee/cc):0;
    else if(cc<1e-20)s=clamp(-dd/aa);
    else {
      const den=aa*cc-bb*bb;s=den>1e-20?clamp((bb*ee-cc*dd)/den):0;t=(bb*s+ee)/cc;
      if(t<0){t=0;s=clamp(-dd/aa);}else if(t>1){t=1;s=clamp((bb-dd)/aa);}
    }
    const delta=sub(mix(a,b,s),mix(c,d,t));
    return {s,t,delta,distance:norm(delta)};
  }
  const segmentDistance=(a,b,c,d)=>closest(a,b,c,d).distance;

  // Capsule contacts on an adaptively flattened spline. Adjacent material is
  // a connected joint, not an obstacle. Local curvature is not a collision.
  function capsules(points,diameter) {
    const tolerance=Math.min(.02,diameter*.002),segments=[];let along=0;
    function flatten(bez,u0,u1,depth=0){
      const [a,b,c,d]=bez;
      if(depth<16&&(Math.max(segmentDistance(b,b,a,d),segmentDistance(c,c,a,d))>tolerance||norm(sub(d,a))>diameter*.5)){
        const ab=mix(a,b,.5),bc=mix(b,c,.5),cd=mix(c,d,.5),abc=mix(ab,bc,.5),bcd=mix(bc,cd,.5),mid=mix(abc,bcd,.5),um=(u0+u1)/2;
        flatten([a,ab,abc,mid],u0,um,depth+1);flatten([mid,bcd,cd,d],um,u1,depth+1);return;
      }
      if(segments.length>=4096)throw Error('Interactive collision check is too complex');
      const end=along+norm(sub(d,a));segments.push({a,b:d,u0,u1,start:along,end});along=end;
    }
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],m=evaluate(points,basis(points.length,i,true)),n=evaluate(points,basis(points.length,i+1,true));
      flatten([a,a.map((v,k)=>v+m[k]/3),b.map((v,k)=>v-n[k]/3),b],i,i+1);
    }
    return segments;
  }
  function contacts(points,diameter,margin=0) {
    const segments=capsules(points,diameter),result=[],gap=Math.PI*diameter/2,clearance=diameter+margin;
    // Sweep bounding boxes along their widest axis. Keep material-order contact
    // resolution identical to the all-pairs solver after removing distant pairs.
    const boxes=segments.map((s,i)=>({i,lo:s.a.map((v,k)=>Math.min(v,s.b[k])),hi:s.a.map((v,k)=>Math.max(v,s.b[k]))}));
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const box of boxes)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],box.lo[k]);hi[k]=Math.max(hi[k],box.hi[k]);}
    let axis=0;for(let k=1;k<3;k++)if(hi[k]-lo[k]>hi[axis]-lo[axis])axis=k;
    boxes.sort((a,b)=>a.lo[axis]-b.lo[axis]);
    const pairs=[];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
      const x=boxes[i],y=boxes[j];
      if(y.lo[axis]-x.hi[axis]>clearance)break;
      const ai=Math.min(x.i,y.i),bi=Math.max(x.i,y.i),a=segments[ai],b=segments[bi];
      if(b.start-a.end<gap)continue;
      let separated=false;
      for(let k=0;k<3;k++)if(x.lo[k]-y.hi[k]>clearance||y.lo[k]-x.hi[k]>clearance){separated=true;break;}
      if(!separated)pairs.push([ai,bi]);
    }
    pairs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for(const [i,j] of pairs) {
      const a=segments[i],b=segments[j],hit=closest(a.a,a.b,b.a,b.b);
      if(hit.distance<clearance)result.push({...hit,a,b,clearance});
    }
    return result;
  }
  function collides(points,diameter) {
    if(!Number.isFinite(diameter)||diameter<=0)return true;
    return contacts(points,diameter,-Math.min(.02,diameter*.002)).length>0;
  }
  function project(points,gradients,error,mass,strength=1,limit=Infinity){
    if(mass.axisLock) {
      const {index,axis}=mass.axisLock;
      gradients=[...gradients].map(([i,g])=>[i,i===index?g.map((v,k)=>k===axis?v:0):g]);
    }
    let denominator=0;
    for(const [i,g] of gradients)denominator+=mass[i]*dot(g,g);
    if(denominator<1e-15)return;
    const lambda=Math.max(-limit,Math.min(limit,error*strength/denominator));
    for(const [i,g] of gradients)for(let k=0;k<3;k++)points[i][k]-=mass[i]*g[k]*lambda;
  }
  function solveContacts(state) {
    const {points,previous,mass,diameter}=state;
    const skin=Math.min(.02,diameter*.002)*3;
    // Sequential contacts are rebuilt each pass; stale contacts share particles.
    for(const hit of contacts(points,diameter,skin)){
      const ua=hit.a.u0+(hit.a.u1-hit.a.u0)*hit.s,ub=hit.b.u0+(hit.b.u1-hit.b.u0)*hit.t;
      const a=basis(points.length,ua),b=basis(points.length,ub),delta=sub(evaluate(points,a),evaluate(points,b));
      const distance=norm(delta);if(distance>=hit.clearance)continue;
      let normal=distance>1e-8?delta:sub(evaluate(previous,a),evaluate(previous,b));
      if(norm(normal)<1e-8){
        const tangent=sub(hit.a.b,hit.a.a),axis=Math.abs(tangent[2])<Math.abs(tangent[0])?[0,0,1]:[1,0,0];
        normal=[tangent[1]*axis[2]-tangent[2]*axis[1],tangent[2]*axis[0]-tangent[0]*axis[2],tangent[0]*axis[1]-tangent[1]*axis[0]];
      }
      const size=norm(normal)||1;normal=normal.map(v=>v/size);
      const coeff=new Map(a);for(const [i,w] of b)coeff.set(i,(coeff.get(i)||0)-w);
      project(points,[...coeff].map(([i,w])=>[i,normal.map(v=>w*v)]),distance-hit.clearance,mass,1,diameter*.2);
    }
  }
  function solveObstacle(state) {
    if(!state.obstacle)return;
    const radius=state.diameter/2+.06;
    // Sample the curved material, not just control particles. A swept test
    // prevents a fast grab from jumping through a thin solid between frames.
    const segments=capsules(state.points,state.diameter);
    for(const segment of segments)for(const u of [segment.u0,(segment.u0+segment.u1)/2,segment.u1]) {
      const b=basis(state.points.length,u),p=evaluate(state.points,b);
      const correction=state.obstacle.contact(p,radius,evaluate(state.previous,b));
      if(!correction)continue;
      const depth=norm(correction);if(depth<1e-9)continue;
      const normal=correction.map(v=>v/depth);
      project(state.points,b.map(([i,w])=>[i,normal.map(v=>w*v)]),-depth,state.mass,1);
    }
  }
  function obstacleCollides(points,diameter,obstacle,previous=null) {
    if(!obstacle)return false;
    for(const segment of capsules(points,diameter))for(const u of [segment.u0,(segment.u0+segment.u1)/2,segment.u1]) {
      if(obstacle.contact(at(points,u),diameter/2-.01,previous?at(previous,u):null))return true;
    }
    return false;
  }
  function solveBending(state) {
    const strength=.18*(state.stiffness||0)**2;
    if(!strength)return;
    const {points,mass}=state;
    const first=state.spanEdit?state.spanEdit.a+1:1;
    const last=state.spanEdit?state.spanEdit.b:points.length-1;
    for(let i=first;i<last;i++) {
      const left=norm(sub(points[i],points[i-1])),right=norm(sub(points[i+1],points[i]));
      const a=right/(left+right||1),b=1-a;
      for(let k=0;k<3;k++) {
        const gradients=[[i-1,-a],[i,1],[i+1,-b]].map(([j,w])=>[j,[0,1,2].map(axis=>axis===k?w:0)]);
        project(points,gradients,points[i][k]-a*points[i-1][k]-b*points[i+1][k],mass,strength);
      }
    }
  }
  function createSpanEdit(points,options,loosen=false) {
    const pins=[...(options.pins||[])].sort((a,b)=>a-b),u=options.u;
    if(pins.some(i=>Math.abs(i-u)<1e-6))throw Error('Click between the pins, rather than on a pin');
    const b=pins.find(i=>i>u)??points.length-1,a=pins.filter(i=>i<u).at(-1)??0;
    if(b-a<1)throw Error('Select a curve section');
    const state=create(points,options);
    const arc=state.rest.slice(a,b).reduce((sum,v)=>sum+v,0);
    const fixedEnds=pins.includes(a)&&pins.includes(b);
    const chord=Math.max(fixedEnds?norm(sub(points[b],points[a])):.02,10-(length(points)-arc));
    if(!loosen&&arc-chord<.02)throw Error('This section cannot be shortened further');
    // Edit only the selected interval; pins and external particles stay fixed.
    state.mass=points.map((_,i)=>i>=a&&i<=b&&!pins.includes(i)?1:0);
    state.taut=false;
    const added=Math.min(arc*.05,1000-length(points));
    if(loosen&&added<1e-6)throw Error('Maximum total length reached');
    state.spanEdit={a,b,q:state.q.slice(a,b).flat(),initial:arc,chord,loosen,limit:arc+Math.max(0,1000-length(points)),target:arc,desired:loosen?arc+added:arc-.2*(arc-chord)};
    // A straight span needs a small transverse seed to escape collinearity.
    if(loosen&&fixedEnds&&arc-chord<.02) {
      const axis=sub(points[b],points[a]),size=norm(axis);
      const direction=axis.map(v=>v/(size||1));
      const k=direction.map(Math.abs).indexOf(Math.min(...direction.map(Math.abs)));
      const normal=direction.map((v,j)=>(j===k?1:0)-direction[k]*v),n=norm(normal);
      for(let i=a+1;i<b;i++)for(let j=0;j<3;j++)
        state.points[i][j]+=normal[j]/n*Math.sin(Math.PI*(i-a)/(b-a))*Math.sqrt(arc*Math.min(added,options.diameter*.025))*2/Math.PI;
      state.previous=state.points.map(p=>p.slice());
    }
    return state;
  }

  function setSpanDuration(state,seconds) {
    const t=state.spanEdit;
    if(!t||!Number.isFinite(seconds)||seconds<0)throw Error('Invalid hold duration');
    t.desired=t.loosen?Math.min(t.limit,t.initial*(1+.05*seconds))
      :t.chord+(t.initial-t.chord)*Math.pow(.8,seconds);
  }

  function createTension(points,options){return createSpanEdit(points,options);}
  function createSlack(points,options){return createSpanEdit(points,options,true);}

  function create(points,options){
    const q=quadrature(points.length),original=points.map(p=>p.slice());
    const rest=q.map(s=>measure(points,s).value),total=rest.reduce((a,b)=>a+b,0);
    const target=options.target, pins=new Set(options.pins||[]);
    const mass=points.map((_,i)=>pins.has(i)?0:1);
    mass.axisLock=options.pinAxis;
    const ordered=[...pins].sort((a,b)=>a-b);
    // A straight span between pins has no slack. Freeze that span while leaving
    // the unpinned tails free to respond to a grab.
    for(let j=1;j<ordered.length;j++) {
      const a=ordered[j-1],b=ordered[j],arc=rest.slice(a,b).reduce((sum,v)=>sum+v,0);
      if(arc-norm(sub(points[b],points[a]))<1e-6)for(let i=a;i<=b;i++)mass[i]=0;
    }
    return {...options,points:original.map(p=>p.slice()),previous:original.map(p=>p.slice()),original,q,flatQ:q.flat(),
      rest:rest.map(v=>target===null?v:v*target/total),
      mass,
      grab:basis(points.length,options.u),anchor:at(points,options.u),speed:0,
      taut:mass.every(v=>v===0)};
  }
  function solveLengths(state,reverse=false){
    const {points,q,rest,mass,target}=state;
    if(target===null)return;
    const first=state.spanEdit?.a||0,last=state.spanEdit?.b??q.length;
    for(let j=first;j<last;j++){
      const i=reverse?last-1-(j-first):j,m=measure(points,q[i],true);
      project(points,m.gradients,m.value-rest[i],mass);
    }
  }
  function closeLength(state){
    if(state.target===null)return;
    const t=state.spanEdit;
    const m=measure(state.points,(t?t.q:state.flatQ),true);
    project(state.points,m.gradients,m.value-(t?t.target:state.target),state.mass);
  }
  function step(state,mouse,iterations=10){
    if(state.taut)return state.points;
    const {points,previous,mass,diameter,grab}=state;
    if(state.spanEdit) {
      const t=state.spanEdit,next=t.target+Math.sign(t.desired-t.target)*Math.min(Math.abs(t.desired-t.target),diameter*.025);
      for(let i=t.a;i<t.b;i++)state.rest[i]*=next/t.target;
      t.target=next;
    }
    // UI grabs use a screen-scaled step; non-interactive solves retain physical defaults.
    const grabStep=mouse && Number.isFinite(state.grabStep) && state.grabStep>0 ? state.grabStep : diameter*.18;
    const before=points.map(p=>p.slice());
    for(let i=0;i<points.length;i++){
      const v=sub(points[i],previous[i]),s=Math.min(.72,(grabStep*2/3)/(norm(v)||1));
      previous[i]=points[i].slice();
      if(mass[i])for(let k=0;k<3;k++)points[i][k]+=v[k]*s;
    }
    const handle=evaluate(state.screenGrab?before:points,grab);
    const goal=mouse?mix(handle,mouse,Math.min(1,grabStep/(norm(sub(mouse,handle))||1))):null;
    for(let pass=0;pass<iterations;pass++){
      if(goal){
        const current=evaluate(points,grab);
        for(let k=0;k<3;k++)project(points,grab.map(([i,w])=>[i,[0,1,2].map(axis=>axis===k?w:0)]),current[k]-goal[k],mass,.8);
      }
      solveBending(state);
      solveLengths(state,pass%2===1);
      if(state.collision&&pass%3===2){solveContacts(state);solveObstacle(state);}
    }
    // Close the scalar length residual without a global similarity transform.
    // This also keeps the backend/export length check consistent with the UI.
    for(let pass=0;pass<12;pass++){
      closeLength(state);
      if(state.collision&&pass%3===2){solveContacts(state);solveObstacle(state);}
    }
    closeLength(state);closeLength(state);
    solveObstacle(state);
    state.speed=Math.max(...points.map((p,i)=>norm(sub(p,before[i]))));
    return points;
  }
  function minimumLength(points,pins=[]) {
    return Math.max(10,length(points.slice(0,Math.max(3,...pins.map(i=>i+1)))));
  }
  function resize(points,requested,pins=[]) {
    const original=length(points),target=Math.max(minimumLength(points,pins),Math.min(1000,requested));
    if(Math.abs(target-original)<1e-7)return points.map(p=>p.slice());
    let make,lo=0,hi=1;
    if(target>original){
      const end=points.at(-1),edge=sub(end,points.at(-2)),size=norm(edge),direction=edge.map(v=>v/size);
      const count=Math.min(129-points.length,Math.max(1,Math.ceil((target-original)/Math.max(size,2.5))));
      if(count===0){
        if(pins.includes(points.length-1))throw Error('Remove the end pin before extending this fully subdivided curve');
        make=d=>[...points.slice(0,-1).map(p=>p.slice()),end.map((v,k)=>v+direction[k]*d)];
      }else{
        make=d=>[...points.map(p=>p.slice()),...Array.from({length:count},(_,i)=>end.map((v,k)=>v+direction[k]*d*(i+1)/count))];
      }
      hi=target-original+size;
      while(length(make(hi))<target)hi*=2;
    }else{
      const minCount=Math.max(3,...pins.map(i=>i+1));
      let count=points.length;
      while(count>minCount&&length(points.slice(0,count))>target)count--;
      const prefix=points.slice(0,count).map(p=>p.slice());
      if(Math.abs(length(prefix)-target)<1e-7)return prefix;
      if(count===points.length)return prefix;
      make=t=>[...prefix,mix(points[count-1],points[count],t)];
    }
    for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(length(make(mid))<target)lo=mid;else hi=mid;}
    const result=make((lo+hi)/2);
    if(norm(sub(result.at(-1),result.at(-2)))<.01)result.pop();
    if(result.length<3||Math.abs(length(result)-target)>.01)throw Error('This length is too close to a curve joint; choose a slightly different length');
    return result;
  }

  const api={obstacleCollides,length,at,segmentDistance,collides,create,createTension,createSlack,setSpanDuration,step,resize,minimumLength};
  if(typeof module!=='undefined')module.exports=api;else root.FluixerInteractive=api;
})(typeof window==='undefined'?{}:window);
