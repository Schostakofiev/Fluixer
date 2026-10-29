(() => {
  const steps = [
    {tab:'pipe', group:0, title:'1. Pipe', label:'Choose a curve', demo:'choose', text:'Open Pipeline Curve and choose a path. This example selects S-Curve. STEP imports a path; Interactive lets you shape one.', focus:'Choose the path before adding a pattern.', role:'INPUT · 1 / 2'},
    {tab:'pipe', group:0, title:'1. Pipe', label:'Adjust the dimensions', demo:'size', text:'Drag the size slider or enter an exact value. Radius / Width and Height set the overall size; inner and outer diameter describe the pipe.', focus:'Radius / Width and Height control the overall pipe dimensions.', role:'INPUT · 2 / 2'},
    {tab:'pattern', group:1, title:'2. Pattern', label:'Paint on the plane · 2D', demo:'brush2d', text:'Choose Brush, then 2D. The plane opens and the brush is selected. Paint on the plane to create liquid segments; use the eraser to remove marks.', focus:'Brush → 2D → paint on the projection plane.', role:'PATTERN · 1 / 2'},
    {tab:'pattern', group:1, title:'2. Pattern', label:'Paint on the pipe · 3D', demo:'brush3d', text:'Switch to 3D to paint directly on the visible pipe. The brush does not penetrate hidden pipe sections. Brush size appears beside the selected tool.', focus:'Paint the visible pipe; rotate the view to reach other sides.', role:'PATTERN · 2 / 2'},
    {tab:'output', group:2, title:'3. Serial / CSV', label:'Connect a serial device', demo:'serial', text:'Click Connect, select the device in the browser port chooser and confirm. Without imported CSV, choose Run Original or Run Compensated. With CSV imported, run that file.', focus:'Demonstration only — no device request or command is sent.', role:'OUTPUT · SIMULATION'},
    {tab:'calibration', group:3, title:'4. Calib', label:'Photo calibration', demo:'reference', text:'Output the 100-step leveling pattern, photograph it, then open Photo Calibration. Import the photo, mark the 80 mm reference, sample the liquid color and inspect the detected endpoints. Apply the detected compensation.', focus:'This sample image runs through the real recognition and compensation calculation.', role:'CALIBRATION · 1 / 2'},
    {tab:'calibration', group:3, title:'4. Calib', label:'Apply and refine the curve', demo:'curve', text:'Apply the measurements to Geometric Compensation, then drag control points to refine the curve. Click the curve to add a point; Alt-click a point to delete it.', focus:'Use compensated preview to inspect the result, then export compensated CSV.', role:'CALIBRATION · 2 / 2'},
  ];
  const help = document.createElement('button');
  help.id='tour-help'; help.className='btn-icon'; help.type='button';
  help.innerHTML='<img class="ico button-svg" src="/svg/help.svg" alt="" aria-hidden="true" draggable="false" />'; help.title='Quick Guide'; help.setAttribute('aria-label','Open Quick Guide');
  const dialog=document.createElement('dialog'); dialog.id='quick-guide'; dialog.setAttribute('aria-labelledby','tour-title');
  dialog.innerHTML=`<div class="tour-spotlight" aria-hidden="true"></div><div class="tour-cursor" aria-hidden="true"><img src="/svg/cursor.svg" alt="" draggable="false" /></div><div class="tour-target" aria-hidden="true"></div>
    <section class="tour-card">
      <div class="tour-heading"><span id="tour-role"></span><button class="btn-icon" type="button" id="tour-close" aria-label="Close guide"><img class="ico button-svg" src="/svg/close.svg" alt="" aria-hidden="true" draggable="false" /></button></div>
      <div class="tour-progress"><div></div></div>
      <div id="tour-content" aria-live="polite"><h2 id="tour-title"></h2><h3 id="tour-subtitle"></h3><p id="tour-text"></p><p id="tour-note"></p><div class="tour-demo-bar"><span id="tour-demo-caption"></span><button type="button" class="btn-icon" id="tour-replay" aria-label="Replay demonstration" title="Replay demonstration"><img class="ico button-svg" src="/svg/reset.svg" alt="" aria-hidden="true" draggable="false" /></button></div><div id="tour-focus"></div></div>
      <footer class="tour-actions"><button class="btn btn-outline" id="tour-back" type="button">Back</button><span id="tour-count"></span><button class="btn btn-primary" id="tour-next" type="button">Next</button></footer>
    </section>`;
  document.body.append(help,dialog);
  const find=id=>dialog.querySelector('#'+id), card=dialog.querySelector('.tour-card'), spot=dialog.querySelector('.tour-spotlight');
  let index=0, saved=null, frame=null, animations=[], demoEpoch=0, demoRestore=[], spotlightTarget=null, internalCloses=0;
  const virtualCursor=dialog.querySelector('.tour-cursor'), targetRing=dialog.querySelector('.tour-target');
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animate(el,values,options={}) {
    if(window.Motion) animations.push(Motion.animate(el,values,{...options,duration:reduced()?0:(options.duration??.28)}));
    else for(const [key,value] of Object.entries(values)) el.style[key]=Array.isArray(value)?value.at(-1):value;
  }
  function stopAnimations(){card.classList.remove('tour-card-photo');$('calibration-dialog').classList.remove('tour-photo-active');spotlightTarget=null;++demoEpoch;for(const a of animations)a.stop();animations=[];for(const restore of demoRestore.reverse())restore();demoRestore=[];targetRing.hidden=true;virtualCursor.hidden=true;}
  function layout() {
    if(!dialog.open)return;
    const sidebar=document.querySelector('aside'), viewport=document.querySelector('.viewport');
    const region=spotlightTarget?.closest('#calibration-dialog') ||
      (spotlightTarget?.closest('.viewport') ? viewport :
        spotlightTarget?.id==='curve-preview' ? spotlightTarget : sidebar);
    spot.hidden=region===viewport;
    const photo=region.id==='calibration-dialog';
    card.classList.toggle('tour-card-photo',photo);
    $('calibration-dialog').classList.toggle('tour-photo-active',photo);
    const rect=region.getBoundingClientRect(),side=sidebar.getBoundingClientRect();
    const pad=6,left=Math.max(4,rect.left-pad),top=Math.max(4,rect.top-pad);
    Object.assign(spot.style,{left:left+'px',top:top+'px',width:Math.max(0,Math.min(innerWidth-left-4,rect.right+pad-left))+'px',height:Math.max(0,Math.min(innerHeight-top-4,rect.bottom+pad-top))+'px'});
    spot.dataset.region=region===viewport?'viewport':region.id||'sidebar';
    if(photo){
      Object.assign(card.style,{width:Math.min(440,innerWidth*.34)+'px',left:(rect.right+16)+'px',top:rect.top+'px'});
      card.classList.remove('tour-card-compact');
      return;
    }
    const inView=region===viewport;
    const width=Math.min(inView?Math.max(260,side.width-20):440,innerWidth-24);card.style.width=width+'px';
    const fits=rect.right+28+width<=innerWidth-12;
    card.style.left=(inView?Math.max(12,side.left+10):fits?rect.right+28:Math.max(12,(innerWidth-width)/2))+'px';
    card.style.top=Math.max(12,Math.min((innerHeight-card.offsetHeight)/2,innerHeight-card.offsetHeight-12))+'px';
    card.classList.toggle('tour-card-compact',!fits);
  }

  function showStep() {
    stopAnimations(); const step=steps[index];
    selectSidebarTab(step.tab);
    find('tour-title').textContent=step.title;find('tour-subtitle').textContent=step.label;
    find('tour-role').textContent=step.role;find('tour-text').textContent=step.text;
    find('tour-focus').textContent=step.focus;
    find('tour-note').textContent=step.tab==='calibration'&&$('tab-calibration').disabled?'Calib is available for Cylinder Helix and S-Curve only. This guide does not change your selected pipe.':'';
    find('tour-back').disabled=index===0;find('tour-next').textContent=index===steps.length-1?'Finish':'Next';
    find('tour-count').textContent=`${index+1} / ${steps.length}`;
    playDemo(step.demo);
    layout();
    card.scrollTop=0;
    animate(find('tour-content'),{opacity:[0,1],transform:['translateY(10px)','translateY(0)']});
    animate(dialog.querySelector('.tour-progress div'),{width:`${(index+1)/steps.length*100}%`});
  }
  // Use normal control handlers and calculations. Restore the project on exit.
  // Serial actions remain demonstration-only.
  function playDemo(kind) {
    const epoch=demoEpoch, caption=find('tour-demo-caption');
    virtualCursor.hidden=false;targetRing.hidden=false;caption.textContent='Preparing demonstration…';
    const setValue=(id,value)=>{const el=$(id);el.value=String(value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
    const current=()=>epoch===demoEpoch&&dialog.open;
    async function settled(){
      while(current()&&(previewLoading||previewQueued||calibPreviewReading))await new Promise(resolve=>setTimeout(resolve,50));
      return current();
    }
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,reduced()?50:ms));
    async function point(id,description,action,fx=.5,fy=.5) {
      if(epoch!==demoEpoch||!dialog.open)return false;
      const el=typeof id==='string'?$(id):id;el.scrollIntoView({block:'nearest'});
      targetRing.hidden=el===canvas||el===curveCanvas||el.id==='calibration-photo';
      spotlightTarget=el.dataset.guideSource?$(el.dataset.guideSource):el;layout();
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
      list.className='tour-select-list';list.dataset.guideSource=id;
      list.size=Math.max(2,list.options.length);list.disabled=false;list.tabIndex=-1;
      list.setAttribute('aria-hidden','true');
      for(const property of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','direction'])list.style[property]=style[property];
      const height=Math.min(list.options.length*28+4,innerHeight-24);
      Object.assign(list.style,{position:'fixed',left:Math.max(8,Math.min(rect.left,innerWidth-rect.width-8))+'px',top:Math.max(8,Math.min(rect.bottom,innerHeight-height-8))+'px',width:rect.width+'px',height:height+'px'});
      dialog.append(list);demoRestore.push(()=>list.remove());
      const optionIndex=[...list.options].findIndex(option=>option.value===value);
      const ok=await point(list,description,()=>{list.value=value;setValue(id,value);},.45,(optionIndex+.5)/list.options.length);
      list.remove();if(ok)targetRing.hidden=true;return ok&&await settled();
    }
    async function run() {
      if(!await settled())return;
      if(kind==='choose') {
        if(!await selectOption('pipe-type','s-curve','Select S-Curve'))return;
        spotlightTarget=$('pipe-type');layout();targetRing.hidden=true;
        caption.textContent='S-Curve preview';
      } else if(kind==='size') {
        await point('pipe-radius','Pipe width / radius');
        if(current())await point('pipe-height','Pipe height');
      } else if(kind==='brush2d'||kind==='brush3d') {
        if(!await selectOption('pattern-type','brush','Choose Brush'))return;
        if(!await selectOption('brush-mode',kind==='brush2d'?'2d':'3d',kind==='brush2d'?'Choose 2D':'Choose 3D'))return;
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
        await settled();
      } else if(kind==='serial') {
        await point('serial-connect','Click Connect — demonstration only');
        if(epoch===demoEpoch)await point('serial-compensated','After selecting your port, run compensated data');
        if(epoch===demoEpoch)await point('csv-import','Or import an existing CSV');
      } else if(kind==='reference') {
        if(!await point('calibration-open','Open Photo Calibration'))return;
        const photoDialog=$('calibration-dialog'),wasOpen=photoDialog.open;
        if(!wasOpen){
          $('calibration-open').click();
          if(!photoDialog.open){caption.textContent='Photo Calibration requires Cylinder Helix or S-Curve and an unlocked project.';return;}
          demoRestore.push(()=>photoDialog.close());
          // Keep the guide above the real modal without moving or restyling it.
          internalCloses++;dialog.close();dialog.showModal();
        }
        if(!await point('calibration-file-open','Import a sample calibration image',async()=>{
          const bars=Array.from({length:10},(_,i)=>`<rect x="${180+20*Math.sin(i*.7)}" y="${90+i*34}" width="100" height="12" rx="6" fill="#edc600"/>`).join('');
          const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="white"/><rect x="40" y="40" width="400" height="400" rx="20" fill="#f3f3f3" stroke="#aaa"/>${bars}</svg>`;
          const transfer=new DataTransfer();transfer.items.add(new File([svg],'guide-calibration.svg',{type:'image/svg+xml'}));
          $('calibration-file').files=transfer.files;$('calibration-file').dispatchEvent(new Event('change',{bubbles:true}));
          const deadline=Date.now()+15000;
          while(current()&&$('calibration-photo').hidden&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
          if(current()&&$('calibration-photo').hidden)throw Error('Sample image did not load');
        }))return;
        if(!await point('calibration-scale-pick','Mark the 80 mm reference',()=>$('calibration-scale-pick').click()))return;
        const photo=$('calibration-photo');
        const photoClick=(x,y)=>{const r=photo.getBoundingClientRect();photo.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*x,clientY:r.top+r.height*y}));};
        if(!await point(photo,'First reference point',()=>photoClick(40/480,50/480),40/480,50/480))return;
        if(!await point(photo,'Second reference point',()=>photoClick(440/480,50/480),440/480,50/480))return;
        if(!await point('calibration-pick-color','Sample the liquid color',()=>$('calibration-pick-color').click()))return;
        if(!await point(photo,'Sample a liquid segment',()=>photoClick(220/480,96/480),220/480,96/480))return;
        await new Promise(resolve=>setTimeout(resolve,200));if(!current())return;
        if($('calibration-apply').disabled)throw Error($('calibration-error').textContent||'No calibration result');
        if(!await point('calibration-apply','Apply the measured compensation',()=>{
          $('calibration-apply').click();spotlightTarget=$('curve-preview');layout();targetRing.hidden=true;
        }))return;
        await settled();
      } else {
        const initial=selectedCurve(),middle=Math.floor(initial.y.length/2);
        await drag('curve-preview','Drag a control point to refine compensation',.35,.65,t=>{
          const curve=structuredClone(initial);curve.y[middle]=Math.max(-1,Math.min(1,initial.y[middle]+.35*t));
          const rect=curveCanvas.getBoundingClientRect();
          virtualCursor.style.left=(rect.left+(144+120*curve.y[middle])/280*rect.width)+'px';
          virtualCursor.style.top=(rect.top+(24+240*curve.x[middle])/280*rect.height)+'px';
          setCurve(curve);loadDisplay();
        });if(!await settled())return;
        await settled();
      }
      if(epoch===demoEpoch)caption.textContent+=' · Replay to watch again';
    }
    find('tour-replay').disabled=false;
    run().catch(error=>{if(epoch===demoEpoch)caption.textContent='Guide paused: '+error.message;});
  }
  function available(){return !projectBusy&&!previewLoading&&!csvReading&&!exporting&&!interactiveDrag&&!obstacleDrag&&!brushStroke&&!planeDrag;}
  function sync(){help.disabled=!available();}
  function open(){
    if(dialog.open||!available())return;
    saved={photoRestore:FluixerCalibration.beginGuide(),edit:captureEditState(),runtime:{importedCsv,calibPreviousPreview,compensatedPreview,planeVisible,planeTool:$('plane-tool').value,brushErase,spatialErase,animationProgress,yaw,pitch,zoom,panX,panY},focus:document.activeElement,tabs:sidebarTabKeys.map(key=>({key,hidden:$('panel-'+key).hidden,selected:$('tab-'+key).ariaSelected,tabIndex:$('tab-'+key).tabIndex})),scroll:[...document.querySelectorAll('.sidebar-panel')].map(el=>[el,el.scrollTop])};
    stopAnimation();importedCsv=null;calibPreviousPreview=null;calibPreviewPending=false;calibPreviewReading=false;index=0;dialog.showModal();showStep();find('tour-next').focus();
  }
  function close(){if(dialog.open)dialog.close();}
  dialog.addEventListener('close',()=>{
    if(internalCloses){internalCloses--;return;}
    stopAnimations();if(!saved)return;
    clearTimeout(brushPreviewTimer);brushPreviewTimer=null;
    cancelAnimationFrame(spatialRefresh);clearTimeout(spatialRefresh);spatialRefresh=null;
    calibPreviewPending=false;calibPreviewReading=false;
    saved.photoRestore();
    const original=saved.runtime;
    importedCsv=original.importedCsv;calibPreviousPreview=original.calibPreviousPreview;
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
