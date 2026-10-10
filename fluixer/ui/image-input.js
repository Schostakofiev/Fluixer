// Local raster extraction. No source image is sent to a remote service.
(function(root){
 function extract(data,width,height,{mode='auto',threshold=48,invert=false}={}){
  const n=width*height,mask=new Uint8Array(n),border=[[],[],[]];
  let transparent=false;
  for(let i=0;i<n;i++){if(data[i*4+3]<128)transparent=true;const x=i%width,y=Math.floor(i/width);if((x===0||y===0||x===width-1||y===height-1)&&data[i*4+3]>=128)for(let c=0;c<3;c++)border[c].push(data[i*4+c]);}
  const bg=border.map(a=>{a.sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:255;});
  for(let i=0;i<n;i++){
   const p=i*4,alpha=data[p+3],luma=.2126*data[p]+.7152*data[p+1]+.0722*data[p+2];
   let on=mode==='photo'?alpha>=threshold:mode==='dark'?luma<threshold:mode==='light'?luma>255-threshold:transparent?alpha>=128:Math.hypot(data[p]-bg[0],data[p+1]-bg[1],data[p+2]-bg[2])/Math.sqrt(3)>threshold;
   mask[i]=alpha>0&&Boolean(on)!==invert?1:0;
  }
  return mask;
 }
 const api={extract};if(typeof module!=='undefined')module.exports=api;else root.FluixerImage=api;
})(typeof window==='undefined'?{}:window);
