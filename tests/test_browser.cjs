const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 let browser,server;
 try {
  server=spawn(process.env.FLUIXER_TEST_PYTHON||'python',['-B','-m','fluixer.webapp','--port','0','--no-browser'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Server startup timed out')),15000);server.once('error',e=>{clearTimeout(timer);reject(e)});server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',buf=>{out+=buf;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',b=>process.stderr.write(b));});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  async function scenario(name,test){
   const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);await page.waitForFunction(()=>!!display&&!previewLoading&&!previewQueued&&!!outputPlanForCurrent());
   await page.evaluate(()=>{window.check={
    equal(a,b){if(a!==b)throw Error(`${a} !== ${b}`)},
    deep(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}))},
    ok(v,msg='Assertion failed'){if(!v)throw Error(msg)},
    near(a,b){if(Math.abs(a-b)>1e-8)throw Error(`${a} != ${b}`)},
    throws(fn){let caught=false;try{fn()}catch{caught=true}if(!caught)throw Error('Expected rejection')}
   };});
   try{await test(page);assert.deepEqual(errors,[]);console.log('PASS '+name)}finally{await page.close()}
  }
  await scenario('CSV syntax, limits and forward-only preview',async page=>{
   await page.evaluate(()=>{
    const a=check,h='type,motor,direction,steps,speed,unit,seconds\n',settings={kGas:625,kLiquid:625,preAdd:0,lengthPer100Steps:10};
    for(const row of ['move,l,fwd,2001,400,steps,','move,l,fwd,2.5,400,steps,','move,l,fwd,100,626,steps,','move,l,fwd,90,400,segments,']){a.throws(()=>FluixerSerial.parse(h+row));a.throws(()=>parsePreviewCsv(h+row,settings))}
    for(const csv of [h+'move,l,fwd,100,400,steps,','\ufeff'+h.toUpperCase()+'"MOVE","L","FWD","100","400","STEPS",',h.replace(/\n/g,'\r')+'move,l,fwd,100,400,steps,'])a.equal(parsePreviewCsv(csv,settings).outputCommands[0].steps,100);
    for(const row of ['move,l,rev,100,400,steps,','delay,,,,,,1'])a.throws(()=>parsePreviewCsv(h+row,settings));
   });
  });
  await scenario('POST contract for all 30 pipe/pattern combinations',async page=>{
   const calls=[];await page.route('**/api/display',route=>{calls.push(route.request());return route.fulfill({json:{}})});
   await page.evaluate(async()=>{for(const type of ['cylinder','s-curve','hilbert','custom-step','interactive'])for(const pattern of ['captured-s','empty','brush','image','step','spatial-brush'])await fetchDisplay({type:pattern},{type,radius:40,height:75,diameter:4,wind:16},{amplitude:2,x:[0,1],y:[0,1]});});
   assert.equal(calls.length,30);for(const r of calls){assert.equal(r.method(),'POST');assert.equal(r.headers()['content-type'],'application/json');assert.deepEqual(r.postDataJSON().compensation,{amplitude:2,x:[0,1],y:[0,1]});}
  });
  await scenario('timing, continuous transport and real playback controls',async page=>{
   await page.evaluate(()=>{
    const a=check,h='type,motor,direction,steps,speed,unit,seconds\n',s={kGas:625,kLiquid:625,lengthPer100Steps:10,preAdd:0};
    importedCsv=parsePreviewCsv(h+'move,l,fwd,2000,625,steps,',s);playbackTimingCache=null;
    a.near(playbackTiming().seconds,3.3);a.near(advancePlayback(0,1.65,playbackTiming(),false),.5);a.near(advancePlayback(0,8.25,playbackTiming(),true),2.5);
    importedCsv=parsePreviewCsv(h+'move,l,fwd,2000,312,steps,',s);a.near(playbackTiming().seconds,2000/312*1.03125);
    importedCsv=parsePreviewCsv(h+'move,l,fwd,1000,625,steps,\nmove,g,fwd,1000,125,steps,',s);a.near(playbackTiming().seconds,9.9);a.near(advancePlayback(0,1.65,playbackTiming(),false),.5);
    importedCsv.omittedPreAdd=50;playbackTimingCache=null;a.near(playbackTiming().seconds,5.775);
    importedCsv=parsePreviewCsv(h+'move,l,fwd,2,625,segments,',s);a.near(playbackTiming().seconds,134/625*1.03125);
    const windows=(p,repeat=true)=>movingWindows([{phase:'gas',length:2},{phase:'liquid',length:3},{phase:'gas',length:5}],10,p,repeat);
    a.deep(windows(1),[[2,5]]);a.deep(windows(1.2),[[0,1],[3,6]]);a.deep(windows(2),[[2,5],[7,10]]);a.deep(windows(2.2),[[0,1],[3,6],[8,10]]);a.deep(windows(1.2,false),[[2,5]]);a.deep(windows(1000000.2),windows(2.2));a.deep(windows(0),[]);a.deep(movingWindows([{phase:'gas',length:10}],10,3,true),[]);
    a.ok(Math.abs(windows(.999999)[0][1]-windows(1.000001).at(-1)[1])<.00002);
    importedCsv=parsePreviewCsv(h+'move,l,fwd,2000,625,steps,',s);syncPlayback();
    $('playback-loop').click();a.equal(animationLoop,true);$('playback-play').click();a.equal(animationPlaying,true);$('playback-play').click();a.equal(animationPlaying,false);
    $('playback-progress').value='450';$('playback-progress').dispatchEvent(new Event('input'));a.equal(animationProgress,.45);$('playback-final').click();a.equal(animationProgress,1);a.equal(animationPlaying,false);
    $('playback-loop').click();a.equal(animationLoop,false);
   });
  });
  await scenario('serial Pre-Add delay, ACK holds and stop',async page=>{
   await page.evaluate(()=>{
    const a=check;let now=0,id=0;const frames=new Map();
    const original={raf:window.requestAnimationFrame,caf:window.cancelAnimationFrame,now:performance.now};
    window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};window.cancelAnimationFrame=id=>frames.delete(id);performance.now=()=>now;
    try{
     $('pre-add').value='50';$('k-gas').value=$('k-liquid').value='625';$('length-per-100-steps').value='10';
     const csv='type,motor,direction,steps,speed,unit,seconds\nmove,l,fwd,1000,625,steps,\nmove,g,fwd,1000,625,steps,';
     const tick=ms=>{now=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now))};
     let job=prepareSerialPlayback(csv);job.move({index:0,amount:1000,count:1000,unit:'steps',speed:625});
     tick(500);a.near(animationProgress,0);a.equal(animationPlaying,false);tick(1237.5);a.near(animationProgress,1/6);a.equal(animationPlaying,true);
     job.settled();a.near(animationProgress,1/3);tick(9000);a.near(animationProgress,1/3);
     job.move({index:1,amount:1000,count:1000,unit:'steps',speed:625});tick(9825);a.near(animationProgress,2/3);job.settled();job.complete();job.finish();a.near(animationProgress,1);a.equal(serialPlayback.active,false);
     job=prepareSerialPlayback(csv);job.move({index:0,amount:1000,count:1000,unit:'steps',speed:625});tick(11100);const stopped=animationProgress;job.finish();tick(20000);a.near(animationProgress,stopped);
    }finally{window.requestAnimationFrame=original.raf;window.cancelAnimationFrame=original.caf;performance.now=original.now}
   });
  });
  await scenario('interactive path and tool-switch commit',async page=>{
   await page.click('#tab-pipe');await page.selectOption('#pipe-type','interactive');await page.waitForFunction(()=>!previewLoading&&!previewQueued);
   await page.evaluate(()=>{
    const a=check,p=defaultInteractivePoints();validateInteractivePoints(p);a.equal(interactiveSamples(p).length,257);a.throws(()=>validateInteractivePoints([[0,0,0],[1,0,0],[0,0,0]]));
    const changed=p.map(v=>[v[0],v[1],v[2]+1]);interactivePoints=changed;interactiveTargetLength=80;
    interactiveDrag={frame:null,collision:true,diameter:4,lastValid:changed,original:p,solver:{},id:null};obstacleEditing=true;
    $('interactive-pin').click();a.equal(interactiveDrag,null);a.deep(interactivePoints,changed);a.equal(interactiveTool,'pin');a.equal(obstacleEditing,false);
    const pipe=selectedPipe();a.ok(!('avoid_collisions' in pipe));a.ok(!('mapping' in pipe));
   });
  });
  await scenario('model undo/redo, immutable brushes and project roundtrip',async page=>{
   await page.evaluate(async()=>{
    const a=check,initial=captureEditState(),camera={yaw,pitch,planeVisible,animationProgress};editHistory.reset();
    $('pipe-radius').value='50';commitEditHistory();a.equal(editHistory.undo.length,1);moveEditHistory();a.equal($('pipe-radius').value,initial.fields['pipe-radius'].value);
    a.deep({yaw,pitch,planeVisible,animationProgress},camera);await loadDisplay();moveEditHistory(true);a.equal($('pipe-radius').value,'50');await loadDisplay();
    const raster=imageRaster;brushPixels[0]=1;commitEditHistory();moveEditHistory();a.equal(brushPixels[0],0);a.equal(imageRaster,raster);await loadDisplay();moveEditHistory(true);a.equal(brushPixels[0],1);await loadDisplay();
    const project=currentProject();a.equal(project.schema_version,11);a.ok(!('mapping' in project.cylinder));a.deep(validateProject(JSON.parse(JSON.stringify(project))),project);
   });
  });
  await scenario('calibration sequence independence and stale request cancellation',async page=>{
   await page.locator('#csv-file').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('type,motor,direction,steps,speed,unit,seconds\nmove,l,fwd,100,400,steps,\nmove,g,fwd,2000,400,steps,')});
   await page.waitForFunction(()=>importedCsv&&!csvReading);await page.evaluate(()=>{window.originalImport=importedCsv;animationProgress=.37});
   await page.click('#tab-calibration');await page.waitForFunction(()=>calibrationPreview.sequence&&!calibrationPreview.reading);
   assert(await page.evaluate(()=>importedCsv===window.originalImport&&calibrationPreview.plan.commands.filter(c=>c.motor==='l').every(c=>c.count===100)&&!csvReading));
   await page.click('#tab-output');assert(await page.evaluate(()=>animationProgress===.37&&importedCsv===window.originalImport));
   let release,started;const pending=new Promise(r=>started=r);
   await page.route('**/api/calibration-standard',async route=>{started();await new Promise(r=>release=r);await route.continue()});
   await page.click('#tab-calibration');await pending;await page.click('#tab-output');release();await page.waitForTimeout(600);
   assert(await page.evaluate(()=>!calibrationPreview.active&&!calibrationPreview.sequence&&!calibrationPreview.reading&&importedCsv===window.originalImport));
   await page.unroute('**/api/calibration-standard');
   let calls=0,unblock,first;const firstRequest=new Promise(r=>first=r);
   await page.route('**/api/calibration-standard',async route=>{calls++;if(calls===1){first();await new Promise(r=>unblock=r)}await route.continue()});
   await page.click('#tab-calibration');await firstRequest;
   await page.evaluate(()=>{display={...display};requestId++});unblock();
   await page.waitForFunction(()=>!!calibrationPreview.sequence&&!calibrationPreview.reading);assert.equal(calls,2);
   assert(await page.evaluate(()=>calibrationPreview.plan.commands.filter(c=>c.motor==='l').every(c=>c.count===100)));

  });
  await scenario('spatial brush equivalence, batching and foreground occlusion',async page=>{
   await page.evaluate(()=>{
    const a=check,reference={windows:[],erase:false};
function referenceMerge(windows) {
  const result = [];
  for (const w of windows.sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && w[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], w[1]);
    else result.push(w.slice());
  }
  return result;
}
function referenceStamp(x, y, stroke) {
  const { map, radius } = stroke,
    windows = [];
  for (
    let row = Math.max(0, Math.floor((y - radius) / map.cell));
    row <= Math.min(map.height - 1, Math.ceil((y + radius) / map.cell));
    row++
  )
    for (
      let col = Math.max(0, Math.floor((x - radius) / map.cell));
      col <= Math.min(map.width - 1, Math.ceil((x + radius) / map.cell));
      col++
    ) {
      if (Math.hypot((col + 0.5) * map.cell - x, (row + 0.5) * map.cell - y) > radius) continue;
      const u = map.hits[row * map.width + col];
      if (u >= 0) windows.push([Math.max(0, u - map.pad), Math.min(1, u + map.pad)]);
    }
  const marks = referenceMerge(windows);
  if (reference.erase) {
    for (const [a, b] of marks)
      reference.windows = reference.windows.flatMap(([lo, hi]) =>
        hi <= a || lo >= b
          ? [[lo, hi]]
          : [...(lo < a ? [[lo, a]] : []), ...(hi > b ? [[b, hi]] : [])],
      );
  } else reference.windows = referenceMerge([...reference.windows, ...marks]);
}

    const map={cell:2,width:180,height:120,pad:.00004,hits:Float64Array.from({length:21600},(_,i)=>i%5===0?-1:i/21600),depths:new Float64Array(21600),scale:1,diameter:4};
    const positions=Array.from({length:150},(_,i)=>[140+Math.sin(i/20)*50,100+Math.cos(i/20)*35]);
    for(const erase of [false,true]){
     spatialWindows=erase?[[0,.2],[.3,.6],[.7,1]]:[];reference.windows=structuredClone(spatialWindows);reference.erase=erase;
     for(const [x,y] of positions)referenceStamp(x,y,{map,radius:25});
     const stroke={map,radius:25};
     for(let i=0;i<positions.length;i+=5){const marks=[];for(const [x,y] of positions.slice(i,i+5))spatialStamp(x,y,stroke,marks);applySpatialMarks(marks,erase)}
     a.deep(spatialWindows,reference.windows);a.equal(spatialStamp(...positions.at(-1),stroke).length,0);
    }
    const original={raf:window.requestAnimationFrame,timer:window.setTimeout,load:loadDisplay};let frame,timer,loads=0;
    try{
     $('pattern-type').value='brush';$('brush-mode').value='3d';spatialRefresh=null;previewLoading=true;
     window.requestAnimationFrame=fn=>{frame=fn;return 1};window.setTimeout=fn=>{timer=fn;return 2};loadDisplay=()=>loads++;
     scheduleSpatialRefresh();scheduleSpatialRefresh();frame();a.equal(loads,0);previewLoading=false;timer();a.equal(loads,1);
    }finally{window.requestAnimationFrame=original.raf;window.setTimeout=original.timer;loadDisplay=original.load;previewLoading=false;spatialRefresh=null}
    const layered={cell:2,width:5,height:1,pad:.001,scale:1,diameter:2,hits:new Float64Array([.1,.2,.8,.3,.4]),depths:new Float64Array([0,0,40,0,0])};
    const stroke={map:layered,radius:6},marks=spatialStamp(5,1,stroke);a.equal(marks.length,4);a.ok(marks.every(w=>w[1]<.5));a.equal(spatialStamp(5,1,stroke).length,0);a.equal(spatialStamp(5,1,{map:layered,radius:.9}).length,1);
    layered.depths.set([0,1,40,2,1]);a.equal(spatialStamp(5,1,{map:layered,radius:6}).length,4);
   });
  });
  await scenario('photo markers, slider grouping and isolated keyboard undo',async page=>{
   await page.click('#tab-calibration');await page.waitForFunction(()=>calibrationPreview.sequence&&!calibrationPreview.reading);await page.click('#calibration-open');
   await page.locator('#calibration-file').setInputFiles(path.join(root,'fluixer/ui/images/calibration-guide.jpg'));
   await page.waitForFunction(()=>!document.getElementById('calibration-photo').hidden&&!document.getElementById('calibration-scale-pick').disabled);
   const clickPhoto=async(x,y)=>{const box=await page.locator('#calibration-photo').boundingBox();await page.mouse.click(box.x+box.width*x,box.y+box.height*y)};
   await page.click('#calibration-scale-pick');await clickPhoto(.2,.3);await clickPhoto(.7,.3);
   await page.selectOption('#calibration-mode','manual');await clickPhoto(.5,.4);await clickPhoto(.55,.6);
   await page.waitForFunction(()=>document.getElementById('calibration-result').textContent.startsWith('2 points'));
   await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.getElementById('calibration-result').textContent.startsWith('2 points'));
   await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>document.getElementById('calibration-result').textContent.startsWith('2 points'));
   const slider=page.locator('#calibration-sensitivity'),before=await slider.inputValue();
   await slider.dispatchEvent('pointerdown',{button:0,pointerId:1});await slider.fill('60');await slider.dispatchEvent('input');await slider.fill('70');await slider.dispatchEvent('input');await slider.dispatchEvent('pointerup',{button:0,pointerId:1});await page.waitForTimeout(180);
   await page.locator('#calibration-dialog').dispatchEvent('keydown',{key:'z',ctrlKey:true,bubbles:true});assert.equal(await slider.inputValue(),before);
  });
 }finally{await browser?.close();if(server&&!server.killed)server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
