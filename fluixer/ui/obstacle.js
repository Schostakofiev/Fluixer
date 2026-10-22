(function(root) {
  'use strict';
  const sub=(a,b)=>a.map((v,k)=>v-b[k]),add=(a,b)=>a.map((v,k)=>v+b[k]);
  const mul=(a,t)=>a.map(v=>v*t),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>mul(a,1/(Math.hypot(...a)||1));
  function rotation(v,r,inverse=false) {
    let p=v.slice();
    for(const k of inverse?[2,1,0]:[0,1,2]) {
      const a=r[k]*Math.PI/180*(inverse?-1:1),c=Math.cos(a),s=Math.sin(a),i=(k+1)%3,j=(k+2)%3;
      [p[i],p[j]]=[c*p[i]-s*p[j],s*p[i]+c*p[j]];
    }
    return p;
  }
  function closest(p,[a,b,c]) {
    const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
    if(d1<=0&&d2<=0)return a;
    const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
    if(d3>=0&&d4<=d3)return b;
    const vc=d1*d4-d3*d2;
    if(vc<=0&&d1>=0&&d3<=0)return add(a,mul(ab,d1/(d1-d3)));
    const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
    if(d6>=0&&d5<=d6)return c;
    const vb=d5*d2-d1*d6;
    if(vb<=0&&d2>=0&&d6<=0)return add(a,mul(ac,d2/(d2-d6)));
    const va=d3*d6-d5*d4;
    if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,mul(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));
    const den=1/(va+vb+vc);
    return add(a,add(mul(ab,vb*den),mul(ac,vc*den)));
  }
  function rayTriangle(p,d,t) {
    const e=sub(t[1],t[0]),f=sub(t[2],t[0]),h=cross(d,f),det=dot(e,h);
    if(Math.abs(det)<1e-12)return null;
    const s=sub(p,t[0]),u=dot(s,h)/det;
    if(u< -1e-9||u>1+1e-9)return null;
    const q=cross(s,e),v=dot(d,q)/det;
    if(v< -1e-9||u+v>1+1e-9)return null;
    const distance=dot(f,q)/det;
    return distance>1e-8?distance:null;
  }
  function boxRay(node,p,d,max=Infinity) {
    let lo=0,hi=max;
    for(let k=0;k<3;k++){
      if(Math.abs(d[k])<1e-12){if(p[k]<node.lo[k]||p[k]>node.hi[k])return false;continue;}
      const a=(node.lo[k]-p[k])/d[k],b=(node.hi[k]-p[k])/d[k];
      lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(hi<lo)return false;
    }
    return true;
  }
  function build(triangles) {
    const lo=[0,1,2].map(k=>Math.min(...triangles.map(t=>Math.min(...t.map(p=>p[k])))));
    const hi=[0,1,2].map(k=>Math.max(...triangles.map(t=>Math.max(...t.map(p=>p[k])))));
    if(triangles.length<=8)return {lo,hi,triangles};
    const axis=hi.map((v,k)=>v-lo[k]).indexOf(Math.max(...hi.map((v,k)=>v-lo[k])));
    triangles.sort((a,b)=>a.reduce((s,p)=>s+p[axis],0)-b.reduce((s,p)=>s+p[axis],0));
    const mid=triangles.length>>1;
    return {lo,hi,left:build(triangles.slice(0,mid)),right:build(triangles.slice(mid))};
  }
  function validate(data) {
    if(data===null)return null;
    const vec=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000);
    if(!data||typeof data.name!=='string'||data.name.length>255||!vec(data.position)||!vec(data.rotation)||
       !Array.isArray(data.triangles)||!data.triangles.length||data.triangles.length>12000||
       data.triangles.some(t=>!Array.isArray(t)||t.length!==3||!t.every(vec)))throw Error('Invalid obstacle mesh or transform');
    return data;
  }
  const meshCache=new WeakMap();
  function create(data) {
    validate(data);
    let tree=meshCache.get(data.triangles);
    if(!tree){tree=build(data.triangles.slice());meshCache.set(data.triangles,tree);}
    const center=tree.lo.map((v,k)=>(v+tree.hi[k])/2);
    const local=p=>add(center,rotation(sub(sub(p,center),data.position),data.rotation,true));
    const world=p=>add(add(center,rotation(sub(p,center),data.rotation)),data.position);
    function hits(p,d,max=Infinity) {
      const result=[],stack=[tree];
      while(stack.length){const n=stack.pop();if(!boxRay(n,p,d,max))continue;
        if(n.triangles)for(const t of n.triangles){const v=rayTriangle(p,d,t);if(v!==null&&v<=max)result.push({distance:v,triangle:t});}
        else stack.push(n.left,n.right);
      }
      result.sort((a,b)=>a.distance-b.distance);
      return result.filter((h,i)=>!i||h.distance-result[i-1].distance>1e-7);
    }
    function nearest(p) {
      let best=Infinity,point=null,triangle=null;
      function visit(n){
        const distance=p.reduce((s,v,k)=>s+Math.max(n.lo[k]-v,0,v-n.hi[k])**2,0);
        if(distance>best)return;
        if(n.triangles)for(const t of n.triangles){const q=closest(p,t),d=dot(sub(p,q),sub(p,q));if(d<best){best=d;point=q;triangle=t;}}
        else {visit(n.left);visit(n.right);}
      }
      visit(tree);return {point,distance:Math.sqrt(best),triangle};
    }
    function contact(point,radius,previous=null) {
      const p=local(point);
      if(previous){
        const old=local(previous),delta=sub(p,old),len=Math.hypot(...delta);
        if(len>1e-8){const h=hits(old,mul(delta,1/len),len)[0];
          if(h){let normal=unit(cross(sub(h.triangle[1],h.triangle[0]),sub(h.triangle[2],h.triangle[0])));
            if(dot(normal,delta)>0)normal=mul(normal,-1);
            const target=world(add(add(old,mul(delta,h.distance/len)),mul(normal,radius)));
            return sub(target,point);
          }
        }
      }
      if(p.some((v,k)=>v<tree.lo[k]-radius||v>tree.hi[k]+radius))return null;
      const n=nearest(p);
      const inside=hits(p,unit([1,.371390676,.529182])).length%2===1;
      if(!inside&&n.distance>=radius)return null;
      let normal=n.distance>1e-9?mul(sub(p,n.point),(inside?-1:1)/n.distance)
        :unit(cross(sub(n.triangle[1],n.triangle[0]),sub(n.triangle[2],n.triangle[0])));
      return rotation(mul(normal,inside?radius+n.distance:radius-n.distance),data.rotation);
    }
    return {contact,world,center:world(center),radius:Math.hypot(...tree.hi.map((v,k)=>(v-tree.lo[k])/2)),triangles:data.triangles};
  }
  const api={create,validate,rotation};
  if(typeof module!=='undefined')module.exports=api;else root.FluixerObstacle=api;
})(typeof window==='undefined'?{}:window);
