const assert=require('node:assert/strict');
const csv=require('../fluixer/ui/csv-commands.js');
const h='type,motor,direction,steps,speed,unit,seconds\n';
for(const row of ['move,l,fwd,2001,400,steps,','move,l,fwd,2.5,400,steps,','move,l,fwd,100,626,steps,','move,l,fwd,90,400,segments,'])assert.throws(()=>csv.validateDevice(csv.parse(h+row)));
for(const text of [h+'move,l,fwd,100,400,steps,','\ufeff'+h.toUpperCase()+'"MOVE","L","FWD","100","400","STEPS",',h.replace(/\n/g,'\r')+'move,l,fwd,100,400,steps,'])assert.equal(csv.validateDevice(csv.parse(text))[0].count,100);
assert.equal(csv.validateDevice(csv.parse(h+'delay,,,,,,1'))[0].seconds,1);
console.log('PASS CSV module syntax and device validation');
