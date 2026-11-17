(() => {
  const steps = [
    {tab:'pipe', title:'1. Pipe', label:'Choose a curve', demo:'choose', text:'Open Pipeline Curve to view the available paths. STEP imports a path; Interactive lets you shape one.', focus:'Choose the path before adding a pattern.', role:'INPUT · 1 / 2'},
    {tab:'pipe', title:'1. Pipe', label:'Adjust the dimensions', demo:'size', text:'Drag the size slider or enter an exact value. Radius / Width and Height set the overall size; inner and outer diameter describe the pipe.', focus:'Radius / Width and Height control the overall pipe dimensions.', role:'INPUT · 2 / 2'},
    {tab:'pattern', title:'2. Pattern', label:'Paint on the plane · 2D', demo:'brush2d', text:'Choose Brush, then 2D. The plane opens and the brush is selected. Paint on the plane to create liquid segments; use the eraser to remove marks.', focus:'Brush → 2D → paint on the projection plane.', role:'PATTERN · 1 / 2'},
    {tab:'pattern', title:'2. Pattern', label:'Paint on the pipe · 3D', demo:'brush3d', text:'Switch to 3D to paint directly on the visible pipe. The brush does not penetrate hidden pipe sections. Brush size appears beside the selected tool.', focus:'Paint the visible pipe; rotate the view to reach other sides.', role:'PATTERN · 2 / 2'},
    {tab:'output', title:'3. Serial', label:'Connect a serial device', demo:'serial', text:'Click Connect, select the device in the browser port chooser and confirm. Choose Run Original or Run Compensated to output the current pattern.', focus:'Demonstration only — no device request or command is sent.', role:'OUTPUT · SIMULATION'},
    {tab:'calibration', title:'4. Calib', label:'Photo calibration and curve refinement', demo:'reference', text:'Output the 100-step leveling pattern, photograph it, then open Photo Calibration. Import the photo, mark the 80 mm reference and inspect the detected endpoints. Apply the compensation, then drag a control point to refine the curve.', focus:'Example detection results demonstrate the compensation workflow.', role:'CALIBRATION'},
  ];
  const help = document.createElement('button');
  help.id='tour-help'; help.className='btn-icon'; help.type='button';
  help.innerHTML='<img class="ico button-svg" src="/svg/help.svg" alt="" aria-hidden="true" draggable="false" />'; help.title='Quick Guide'; help.setAttribute('aria-label','Open Quick Guide');
  const dialog=document.createElement('dialog'); dialog.id='quick-guide'; dialog.setAttribute('aria-labelledby','tour-title');
  dialog.innerHTML=`<div class="tour-spotlight" aria-hidden="true"></div><div class="tour-cursor" aria-hidden="true"><img src="/svg/cursor.svg" alt="" draggable="false" /></div><div class="tour-target" aria-hidden="true"></div>
    <section class="tour-card">
      <div class="tour-heading"><span id="tour-role"></span><button class="btn-icon" type="button" id="tour-close" aria-label="Close guide"><img class="ico button-svg" src="/svg/close.svg" alt="" aria-hidden="true" draggable="false" /></button></div>
      <div class="tour-progress" role="progressbar" aria-label="Guide progress" aria-valuemin="0" aria-valuemax="${steps.length}">${steps.map(()=>'<span aria-hidden="true"></span>').join('')}</div>
      <div id="tour-content" aria-live="polite"><h2 id="tour-title"></h2><h3 id="tour-subtitle"></h3><p id="tour-text" class="note"></p><p id="tour-note" class="note"></p><div class="tour-demo-bar"><span id="tour-demo-caption"></span><button type="button" class="btn-icon" id="tour-replay" aria-label="Replay demonstration" title="Replay demonstration"><img class="ico button-svg" src="/svg/reset.svg" alt="" aria-hidden="true" draggable="false" /></button></div><div id="tour-focus"></div></div>
      <footer class="tour-actions"><button class="btn btn-outline" id="tour-back" type="button">Back</button><button class="btn btn-primary" id="tour-next" type="button">Next</button></footer>
    </section>`;
  document.body.append(help,dialog);
  const find=id=>dialog.querySelector('#'+id), card=dialog.querySelector('.tour-card'), spot=dialog.querySelector('.tour-spotlight');
  let index=0, saved=null, frame=null, animations=[], demoEpoch=0, demoRestore=[], phase='sidebar', internalCloses=0;
  const virtualCursor=dialog.querySelector('.tour-cursor'), targetRing=dialog.querySelector('.tour-target');
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animate(el,values,options={}) {
    if(window.Motion) animations.push(Motion.animate(el,values,{...options,duration:reduced()?0:(options.duration??.28)}));
    else for(const [key,value] of Object.entries(values)) el.style[key]=Array.isArray(value)?value.at(-1):value;
  }
  function stopAnimations(){phase='sidebar';$('calibration-dialog').classList.remove('tour-photo-active');++demoEpoch;for(const a of animations)a.stop();animations=[];for(const restore of demoRestore.reverse())restore();demoRestore=[];targetRing.hidden=true;virtualCursor.hidden=true;}
  // The demonstration chooses its layout phase; DOM ancestry never advances it.
  function setPhase(next) {
    phase=next;
    layout();
  }
  function layout() {
    if(!dialog.open)return;
    dialog.dataset.phase=phase;
    const sidebar=document.querySelector('aside'), viewport=document.querySelector('.viewport');
    const region={sidebar,viewport,photo:$('calibration-dialog'),curve:curveCanvas}[phase];
    const brushDemo=['brush2d','brush3d'].includes(steps[index].demo);
    const photo=phase==='photo';
    spot.hidden=(phase==='viewport'&&!brushDemo)||(photo&&!region.open);
    $('calibration-dialog').classList.toggle('tour-photo-active',photo);
    const rect=photo&&!region.open
      ? {left:16,top:16,right:innerWidth-Math.min(440,innerWidth*.34)-32,bottom:innerHeight-16}
      : region.getBoundingClientRect(),side=sidebar.getBoundingClientRect();
    const pad=6,left=Math.max(4,rect.left-pad),top=Math.max(4,rect.top-pad);
    Object.assign(spot.style,{left:left+'px',top:top+'px',width:Math.max(0,Math.min(innerWidth-left-4,rect.right+pad-left))+'px',height:Math.max(0,Math.min(innerHeight-top-4,rect.bottom+pad-top))+'px'});
    spot.dataset.region=region===viewport?'viewport':region.id||'sidebar';
    if(photo){
      Object.assign(card.style,{width:Math.min(440,innerWidth*.34)+'px',left:(rect.right+16)+'px',top:rect.top+'px'});
      return;
    }
    const inView=region===viewport;
    const width=Math.min(inView?Math.max(260,side.width-20):440,innerWidth-24);card.style.width=width+'px';
    const fits=rect.right+28+width<=innerWidth-12;
    card.style.left=(inView?Math.max(12,side.left+10):fits?rect.right+28:Math.max(12,(innerWidth-width)/2))+'px';
    card.style.top=Math.max(12,Math.min((innerHeight-card.offsetHeight)/2,innerHeight-card.offsetHeight-12))+'px';
  }

  function showStep() {
    stopAnimations(); const step=steps[index];
    selectSidebarTab(step.tab);
    find('tour-title').textContent=step.title;find('tour-subtitle').textContent=step.label;
    find('tour-role').textContent=step.role;find('tour-text').textContent=step.text;
    find('tour-focus').textContent=step.focus;
    find('tour-note').textContent=step.tab==='calibration'&&$('tab-calibration').disabled?'Calib is available for Cylinder Helix and S-Curve only. This guide does not change your selected pipe.':'';
    find('tour-back').disabled=index===0;find('tour-next').textContent=index===steps.length-1?'Finish':'Next';
    playDemo(step.demo);
    layout();
    card.scrollTop=0;
    animate(find('tour-content'),{opacity:[0,1],transform:['translateY(10px)','translateY(0)']});
    const progress=dialog.querySelector('.tour-progress');
    progress.setAttribute('aria-valuenow',String(index+1));
    progress.setAttribute('aria-valuetext',`${index+1} / ${steps.length}`);
    [...progress.children].forEach((segment,i)=>segment.classList.toggle('is-complete',i<=index));
  }
  // Use normal control handlers and calculations. Restore the project on exit.
  // Serial actions remain demonstration-only.
  function playDemo(kind) {
    const epoch=demoEpoch, caption=find('tour-demo-caption');
    virtualCursor.hidden=false;targetRing.hidden=false;caption.textContent='Preparing demonstration…';
    const setValue=(id,value)=>{const el=$(id);el.value=String(value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
    const current=()=>epoch===demoEpoch&&dialog.open;
    async function settled(){
      while(current()&&(previewLoading||previewQueued||calibrationPreview.reading))await new Promise(resolve=>setTimeout(resolve,50));
      return current();
    }
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,reduced()?50:ms));
    async function point(id,description,action,fx=.5,fy=.5) {
      if(epoch!==demoEpoch||!dialog.open)return false;
      const el=typeof id==='string'?$(id):id;
      if(phase==='photo'){
        const controls=el.closest('.calibration-photo-controls');
        if(controls){
          const r=el.getBoundingClientRect(),c=controls.getBoundingClientRect();
          if(r.top<c.top)controls.scrollTop+=r.top-c.top;
          else if(r.bottom>c.bottom)controls.scrollTop+=r.bottom-c.bottom;
        }
      }else el.scrollIntoView({block:'nearest'});
      targetRing.hidden=el===canvas||el===curveCanvas||el.id==='calibration-photo';
      layout();
      const r=el.getBoundingClientRect(),x=r.left+r.width*fx,y=r.top+r.height*fy;
      caption.textContent=description;
      Object.assign(targetRing.style,{left:(r.left-4)+'px',top:(r.top-4)+'px',width:(r.width+8)+'px',height:(r.height+8)+'px'});
      const style=getComputedStyle(el);
      for(const corner of ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']) {
        // Match each corner, allowing for the highlight's 4px outward offset.
        targetRing.style[corner]=style[corner].split(/\s+/).map(value=>
          parseFloat(value)===0?'0px':`calc(${value} + 4px)`
        ).join(' ');
      }
      if(window.Motion&&!reduced()){
        const anim=Motion.animate(virtualCursor,{left:x,top:y},{duration:.55,ease:'easeInOut'});animations.push(anim);
      }else Object.assign(virtualCursor.style,{left:x+'px',top:y+'px'});
      await pause(650);if(epoch!==demoEpoch||!dialog.open)return false;
      await pause(180);
      if(epoch!==demoEpoch||!dialog.open)return false;
      await action?.();if(!current())return false;await pause(850);return epoch===demoEpoch&&dialog.open;
    }
    async function drag(id,description,from,to,onMove) {
      if(!await point(id,description,null,from,.5))return;
      const el=$(id),r=el.getBoundingClientRect();
      const render=t=>{if(epoch!==demoEpoch)return;virtualCursor.style.left=(r.left+r.width*(from+(to-from)*t))+'px';onMove?.(t);};
      if(window.Motion&&!reduced()){const a=Motion.animate(0,1,{duration:1.6,ease:'easeInOut',onUpdate:render});animations.push(a);await pause(1700);}else render(1);
    }
    async function selectOption(id, value, description) {
      if(!await point(id,description))return false;
      const source=$(id),rect=source.getBoundingClientRect(),style=getComputedStyle(source);
      const list=source.cloneNode(true);
      list.removeAttribute('id');list.removeAttribute('name');list.removeAttribute('hidden');
      list.className='tour-select-list';
      list.size=Math.max(2,list.options.length);list.disabled=false;list.tabIndex=-1;
      list.setAttribute('aria-hidden','true');
      for(const property of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','direction'])list.style[property]=style[property];
      const height=Math.min(list.options.length*28+4,innerHeight-24);
      Object.assign(list.style,{position:'fixed',left:Math.max(8,Math.min(rect.left,innerWidth-rect.width-8))+'px',top:Math.max(8,Math.min(rect.bottom,innerHeight-height-8))+'px',width:rect.width+'px',height:height+'px'});
      dialog.append(list);demoRestore.push(()=>list.remove());
      if(value===null){await pause(850);return current();}
      const optionIndex=[...list.options].findIndex(option=>option.value===value);
      const ok=await point(list,description,()=>{list.value=value;setValue(id,value);},.45,(optionIndex+.5)/list.options.length);
      list.remove();if(ok)targetRing.hidden=true;return ok&&await settled();
    }
    async function run() {
      if(!await settled())return;
      if(kind==='choose') {
        if(!await selectOption('pipe-type',null,'Open Pipeline Curve'))return;
        targetRing.hidden=true;
        caption.textContent='Available pipe curves';
      } else if(kind==='size') {
        await point('pipe-radius','Pipe width / radius');
        if(current())await point('pipe-height','Pipe height');
      } else if(kind==='brush2d'||kind==='brush3d') {
        if(!await selectOption('pattern-type','brush','Choose Brush'))return;
        if(!await selectOption('brush-mode',kind==='brush2d'?'2d':'3d',kind==='brush2d'?'Choose 2D':'Choose 3D'))return;
        setPhase('viewport');
        const group=kind==='brush2d'?'brush':'spatial',pen=$(group+'-pen');
        if(!await point(pen,'Select the brush',()=>{if(pen.ariaPressed!=='true')pen.click();}))return;
        if(!await point('preview','Draw directly in the view'))return;
        const rect=canvas.getBoundingClientRect();
        let previous=null,stamp=null,mapping=null;
        const radius=Math.max(1,Number($(group+'-size').value)/2);
        if(kind==='brush2d')mapping=brushPlaneMapping();
        else stamp={radius,erase:false,map:spatialHitMap(display,rect,createProjector(rect.width,rect.height),viewScale(rect.width,rect.height))};
        if(kind==='brush2d'&&!mapping)throw Error('Projection plane is not available');
        for(let i=0;i<=32&&current();i++){
          const t=i/32;
          if(mapping){
            const p=[60+136*t,128+36*Math.sin(t*Math.PI*2)];
            virtualCursor.style.left=(rect.left+mapping.o[0]+mapping.ax*p[0]+mapping.bx*p[1])+'px';
            virtualCursor.style.top=(rect.top+mapping.o[1]+mapping.ay*p[0]+mapping.by*p[1])+'px';
            brushLine(previous||p,p,radius,false);previous=p;paintBrush();updateBrushPreview();
          }else{
            const x=rect.width*(.35+.3*t),y=rect.height*.5;
            virtualCursor.style.left=(rect.left+x)+'px';virtualCursor.style.top=(rect.top+y)+'px';
            if(applySpatialMarks(spatialStamp(x,y,stamp),false))scheduleSpatialRefresh();
          }
          await new Promise(resolve=>setTimeout(resolve,reduced()?5:45));
        }
        if(!current())return;
        if(mapping){clearTimeout(brushPreviewTimer);brushPreviewTimer=null;flushBrushPreview();}
        else await loadDisplay();
        if(!await settled()||!current())return;
        if(kind==='brush2d'&&planeVisible){
          if(!await point('plane-toggle','Hide the projection plane',()=>{
            if(planeVisible)$('plane-toggle').click();
          }))return;
        }
      } else if(kind==='serial') {
        await point('serial-connect','Click Connect — demonstration only');
        if(epoch===demoEpoch)await point('serial-compensated','After selecting your port, run compensated data');

      } else if(kind==='reference') {
        if(!await point('calibration-open','Open Photo Calibration'))return;
        const photoDialog=$('calibration-dialog'),wasOpen=photoDialog.open;
        if(!wasOpen){
          setPhase('photo');
          $('calibration-open').click();
          if(!photoDialog.open){setPhase('sidebar');caption.textContent='Photo Calibration requires Cylinder Helix or S-Curve and an unlocked project.';return;}
          demoRestore.push(()=>photoDialog.close());
          // Keep the guide above the real modal without moving or restyling it.
          internalCloses++;dialog.close();dialog.showModal();
        }
        setPhase('photo');
        if(!await point('calibration-file-open','Import a sample calibration image',async()=>{
          const response=await fetch('/images/calibration-guide.jpg');
          if(!response.ok)throw Error('Calibration example image could not be loaded');
          const photoBlob=await response.blob();if(!current())return;
          const transfer=new DataTransfer();transfer.items.add(new File([photoBlob],'calib.jpg',{type:'image/jpeg'}));
          $('calibration-file').files=transfer.files;$('calibration-file').dispatchEvent(new Event('change',{bubbles:true}));
          const deadline=Date.now()+15000;
          while(current()&&$('calibration-photo').hidden&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
          if(current()&&$('calibration-photo').hidden)throw Error('Sample image did not load');
          if(!current())return;
          // Recorded endpoints are a guide fixture, never used by normal photo detection.
          const endpoints=[[553,457],[559,484],[559,512],[570,540],[581,566],[561,594],[570,621],[559,648],[554,676],[558,704],[571,732],[568,759],[529,786]];
          FluixerCalibration.setGuideEndpoints(endpoints.map(([x,y])=>({x:x/1036,y:y/1079})));
        }))return;
        if(!await point('calibration-scale-pick','Mark the 80 mm reference',()=>$('calibration-scale-pick').click()))return;
        const photo=$('calibration-photo');
        const photoClick=(x,y)=>{if(![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Guide photo point is outside the image');const r=photo.getBoundingClientRect();photo.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*x,clientY:r.top+r.height*y}));};
        if(!await point(photo,'First reference point',()=>photoClick(217/1036,320/1079),217/1036,320/1079))return;
        if(!await point(photo,'Second reference point',()=>photoClick(721/1036,320/1079),721/1036,320/1079))return;
        await new Promise(resolve=>setTimeout(resolve,200));if(!current())return;
        if($('calibration-apply').disabled)throw Error($('calibration-error').textContent||'Example compensation is unavailable');
        if(!await point('calibration-apply','Apply the example compensation',()=>{
          $('calibration-apply').click();
          curveCanvas.scrollIntoView({block:'nearest'});
          targetRing.hidden=true;
          setPhase('curve');
        }))return;
        if(!await settled())return;
        const initial=selectedCurve(),middle=Math.floor(initial.y.length/2);
        await drag('curve-preview','Drag a control point to refine compensation',.35,.65,t=>{
          const curve=structuredClone(initial);curve.y[middle]=Math.max(-1,Math.min(1,initial.y[middle]+.35*t));
          const rect=curveCanvas.getBoundingClientRect();
          virtualCursor.style.left=(rect.left+(144+120*curve.y[middle])/280*rect.width)+'px';
          virtualCursor.style.top=(rect.top+(24+240*curve.x[middle])/280*rect.height)+'px';
          setCurve(curve);loadDisplay();
        });if(!await settled())return;
      }

    }
    find('tour-replay').disabled=false;
    run().catch(error=>{if(epoch===demoEpoch)caption.textContent='Guide paused: '+error.message;});
  }
  function available(){return !projectBusy&&!previewLoading&&!calibrationPreview.reading&&!csvReading&&!exporting&&!interactiveDrag&&!obstacleDrag&&!brushStroke&&!planeDrag;}
  function sync(){help.disabled=!available();}
  function open(){
    if(dialog.open||!available())return;
    saved={photoRestore:FluixerCalibration.beginGuide(),edit:captureEditState(),runtime:{importedCsv,calibration:{...calibrationPreview},compensatedPreview,planeVisible,planeTool:$('plane-tool').value,brushErase,spatialErase,animationProgress,yaw,pitch,zoom,panX,panY},focus:document.activeElement,tabs:sidebarTabKeys.map(key=>({key,hidden:$('panel-'+key).hidden,selected:$('tab-'+key).ariaSelected,tabIndex:$('tab-'+key).tabIndex})),scroll:[...document.querySelectorAll('.sidebar-panel')].map(el=>[el,el.scrollTop])};
    stopAnimation();importedCsv=null;stopCalibPreview(false);index=0;dialog.showModal();showStep();find('tour-next').focus();
  }
  function close(){if(dialog.open)dialog.close();}
  dialog.addEventListener('close',()=>{
    if(internalCloses){internalCloses--;return;}
    stopAnimations();if(!saved)return;
    clearTimeout(brushPreviewTimer);brushPreviewTimer=null;
    cancelAnimationFrame(spatialRefresh);clearTimeout(spatialRefresh);spatialRefresh=null;
    stopCalibPreview(false);
    saved.photoRestore();
    const original=saved.runtime;
    importedCsv=original.importedCsv;
    Object.assign(calibrationPreview,original.calibration,{requestId:calibrationPreview.requestId,reading:false});
    compensatedPreview=original.compensatedPreview;planeVisible=original.planeVisible;$('plane-tool').value=original.planeTool;
    brushErase=original.brushErase;spatialErase=original.spatialErase;
    yaw=original.yaw;pitch=original.pitch;zoom=original.zoom;panX=original.panX;panY=original.panY;
    editHistory.restoring=true;
    try{restoreEditState(saved.edit);}finally{editHistory.restoring=false;}
    animationProgress=original.animationProgress;
    syncPlaneTools();syncBrushTool();syncSpatialControls();

    for(const item of saved.tabs){$('panel-'+item.key).hidden=item.hidden;$('tab-'+item.key).ariaSelected=item.selected;$('tab-'+item.key).tabIndex=item.tabIndex;}
    for(const [el,top] of saved.scroll)el.scrollTop=top;
    syncViewEditTools();requestViewDraw();saved.focus?.focus();saved=null;sync();
  });
  find('tour-replay').addEventListener('click',()=>{stopAnimations();layout();playDemo(steps[index].demo);});
  help.addEventListener('click',open);find('tour-close').addEventListener('click',close);
  find('tour-back').addEventListener('click',()=>{if(index>0){index--;showStep();}});
  find('tour-next').addEventListener('click',()=>{if(index===steps.length-1)close();else{index++;showStep();}});
  dialog.addEventListener('keydown',event=>{
    event.stopPropagation(); // Keep app shortcuts inactive while the guide owns focus.
    if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();if(event.key==='ArrowRight')find('tour-next').click();else find('tour-back').click();}
  });
  window.addEventListener('resize',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);});
  new ResizeObserver(()=>{if(dialog.open)layout();}).observe(card);
  window.FluixerTour={sync,get active(){return saved!==null;}};sync();
})();
