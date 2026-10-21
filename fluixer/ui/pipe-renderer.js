/* Real swept triangle meshes. No screen-space pipe strokes. */
(function(){
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const l=Math.hypot(...a);return l>1e-10?a.map(v=>v/l):[0,0,1];};
function mesh(points,outer,inner=0,sides=16){
 points=points.filter((p,i)=>!i||Math.hypot(...sub(p,points[i-1]))>1e-8);if(points.length<2)return new Float32Array();
 const rings=[];let previous=null;
 for(let i=0;i<points.length;i++){
  const t=unit(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)]));
  let n=previous?sub(previous,t.map(v=>v*dot(previous,t))):cross(t,Math.abs(t[2])<.9?[0,0,1]:[0,1,0]);
  if(Math.hypot(...n)<1e-6)n=cross(t,Math.abs(t[2])<.9?[0,0,1]:[0,1,0]);
  n=unit(n);previous=n;const b=unit(cross(t,n));
  rings.push({t,n:Array.from({length:sides},(_,j)=>n.map((v,k)=>v*Math.cos(j*2*Math.PI/sides)+b[k]*Math.sin(j*2*Math.PI/sides)))});
 }
 const out=[];
 const vertex=(i,j,r,sign=1)=>({p:points[i].map((v,k)=>v+r*rings[i].n[j%sides][k]),n:rings[i].n[j%sides].map(v=>v*sign)});
 const tri=(a,b,c)=>{for(const v of [a,b,c])out.push(...v.p,...v.n);};
 for(const [radius,sign] of inner>0?[[outer,1],[inner,-1]]:[[outer,1]])for(let i=0;i<points.length-1;i++)for(let j=0;j<sides;j++){
  const a=vertex(i,j,radius,sign),b=vertex(i+1,j,radius,sign),c=vertex(i+1,j+1,radius,sign),d=vertex(i,j+1,radius,sign);
  tri(a,b,c);tri(a,c,d);
 }
 for(const i of [0,points.length-1])for(let j=0;j<sides;j++){
  const normal=rings[i].t.map(v=>v*(i===0?-1:1));
  const cap=(j,r)=>({...vertex(i,j,r),n:normal});
  tri(cap(j,outer),cap(j+1,outer),cap(j+1,inner));
  if(inner>0)tri(cap(j,outer),cap(j+1,inner),cap(j,inner));
 }
 return new Float32Array(out);
}
class Renderer{
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true});if(!gl)throw Error('WebGL is unavailable on this device');
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=this.program=gl.createProgram();
  gl.attachShader(p,shader(gl.VERTEX_SHADER,`attribute vec3 position;attribute vec3 normal;uniform vec3 center,right,up,back;uniform vec2 scale,pan;uniform float depth;varying vec3 n;void main(){vec3 q=position-center;gl_Position=vec4(dot(q,right)*scale.x+pan.x,dot(q,up)*scale.y+pan.y,-dot(q,back)/depth,1.0);n=normal;}`));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 n;uniform vec4 color;void main(){float light=dot(normalize(n),normalize(vec3(-.4,-.6,1.0)));float shade=light>.45?1.0:(light>-.25?.84:.66);gl_FragColor=vec4(color.rgb*shade,color.a);}`));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  this.printBuffer=gl.createBuffer();this.printCache=null;this.wallBuffer=gl.createBuffer();this.liquidBuffer=gl.createBuffer();this.cache=null;
  this.uniforms=Object.fromEntries(['center','right','up','back','scale','pan','depth','color'].map(name=>[name,gl.getUniformLocation(p,name)]));
  this.attributes=[['position',0],['normal',12]].map(([name,offset])=>[gl.getAttribLocation(p,name),offset]);
 }
 draw(data,segments,inner,frame,basis,scale,pan,rect,ratio,printModel=null){
  const gl=this.gl;const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
  const uniform=(name)=>this.uniforms[name];
  for(const [name,v] of Object.entries({center:frame.center,right:basis.right,up:basis.up,back:basis.back}))gl.uniform3fv(uniform(name),v);
  gl.uniform2f(uniform('scale'),2*scale/rect.width,2*scale/rect.height);gl.uniform2f(uniform('pan'),2*pan[0]/rect.width,-2*pan[1]/rect.height);gl.uniform1f(uniform('depth'),Math.max(frame.extent*4,1));
  if(this.liquidData!==data||this.liquidInner!==inner||this.liquidSegments!==segments){
   const parts=segments.filter(s=>s.phase==='liquid').map(s=>mesh(s.points,inner/2*.997));
   const vertices=new Float32Array(parts.reduce((n,p)=>n+p.length,0));
   let offset=0;for(const part of parts){vertices.set(part,offset);offset+=part.length;}
   this.liquidCount=vertices.length/6;this.liquidSegments=segments;this.liquidData=data;this.liquidInner=inner;
   gl.bindBuffer(gl.ARRAY_BUFFER,this.liquidBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);
  }
  const paint=(buffer,count,color)=>{
   gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   for(const [a,offset] of this.attributes){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,24,offset);}
   gl.uniform4fv(uniform('color'),color);gl.drawArrays(gl.TRIANGLES,0,count);
  };
  if(printModel){
   if(this.printCache!==printModel){
    const vertices=new Float32Array(printModel.vertices);this.printCount=vertices.length/6;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.printBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);this.printCache=printModel;
   }
   gl.disable(gl.BLEND);gl.depthMask(true);paint(this.liquidBuffer,this.liquidCount,[.85,.12,.1,1]);
   gl.bindBuffer(gl.ARRAY_BUFFER,this.printBuffer);
   for(const [a,offset] of this.attributes){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,24,offset);}
   // CAD boundary includes the inner void. Translucency reveals the buried channel.
   gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
   gl.depthMask(false);gl.uniform4fv(uniform('color'),[.72,.75,.78,.12]);gl.drawArrays(gl.TRIANGLES,0,this.printCount);gl.depthMask(true);
   return;
  }
  const geometryChanged=this.cache!==data||this.inner!==inner;
  if(geometryChanged){
   const points=[];for(const s of data.segments)points.push(...s.points);
   const wall=mesh(points,data.cylinder.diameter/2,inner/2);
   this.wallCount=wall.length/6;this.cache=data;this.inner=inner;
   gl.bindBuffer(gl.ARRAY_BUFFER,this.wallBuffer);gl.bufferData(gl.ARRAY_BUFFER,wall,gl.STATIC_DRAW);
  }
  gl.disable(gl.BLEND);gl.depthMask(true);paint(this.liquidBuffer,this.liquidCount,[.78,.24,.21,1]);
  gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);paint(this.wallBuffer,this.wallCount,[.80,.80,.80,.2]);gl.depthMask(true);
 }
}
window.FluixerPipeRenderer=Renderer;window.FluixerPipeMesh=mesh;
})();
