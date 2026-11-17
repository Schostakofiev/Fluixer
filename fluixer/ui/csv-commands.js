/* Shared CSV syntax and device limits for preview and serial output. */
(function(root){
  'use strict';
  function parse(source){
    if(typeof source!=='string'||source.length>4194304)throw Error('CSV exceeds 4 MB');
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const finishField = () => { row.push(field.trim()); field = ''; closed = false; };
  const finishRow = () => {
    finishField();
    if (row.some(v => v !== '')) rows.push({ values: row, line: rowLine });
    row = [];
    if (rows.length > 100001) throw Error('CSV exceeds the 100000 command limit');
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        field += ch;
        if (ch === '\n') line++;
      }
    } else if (ch === ',') finishField();
    else if (ch === '\n') { finishRow(); rowLine = ++line; }
    else if (ch === '"' && !field.trim() && !closed) { field = ''; quoted = true; }
    else if (ch === '"' || (closed && !/\s/.test(ch))) throw Error(`Line ${line}: invalid CSV quoting`);
    else field += ch;
  }
  if (quoted) throw Error(`Line ${rowLine}: unclosed quoted field`);
  if (field || row.length || closed) finishRow();
  const header = ['type', 'motor', 'direction', 'steps', 'speed', 'unit', 'seconds'];
  if (!rows.length || rows[0].values.map(v => v.toLowerCase()).join(',') !== header.join(','))
    throw Error('Expected CSV header: ' + header.join(','));
  if (rows.length < 2) throw Error('CSV contains no commands');

    const number=(raw,name,line)=>{
      if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)||!Number.isFinite(Number(raw)))throw Error(`Line ${line}: invalid ${name}`);
      return Number(raw);
    };
    return rows.slice(1).map(({values,line})=>{
      if(values.length!==7)throw Error(`Line ${line}: expected 7 columns`);
      const [type,motor,direction,value,speed,unit,seconds]=values.map(v=>v.toLowerCase());
      if(type==='delay')return {seconds:number(seconds,'seconds',line),line};
      if(type!=='move'||!['g','l'].includes(motor)||!['fwd','rev'].includes(direction)||!['steps','segments'].includes(unit))throw Error(`Line ${line}: unsupported command`);
      if(seconds!==''&&number(seconds,'seconds',line)!==0)throw Error(`Line ${line}: move cannot include a delay`);
      return {motor,direction,count:number(value,'command value',line),speed:number(speed,'speed',line),unit,line};
    });
  }
  function validateDevice(rows){
    for(const row of rows){
      if('seconds' in row){if(!(row.seconds>0&&row.seconds<=10))throw Error(`Invalid CSV row ${row.line}`);}
      else if(!Number.isInteger(row.count)||row.count<1||row.count>(row.unit==='steps'?2000:89)||!Number.isInteger(row.speed)||row.speed<1||row.speed>625)throw Error(`Invalid CSV row ${row.line}`);
    }
    return rows;
  }
  const api={parse,validateDevice};
  if(typeof module!=='undefined')module.exports=api;else root.FluixerCsv=api;
})(typeof window==='undefined'?{}:window);
