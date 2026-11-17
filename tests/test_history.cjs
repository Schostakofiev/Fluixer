const assert = require('node:assert/strict');
const {History, shortcut} = require('../fluixer/ui/history.js');
let value=0, scope=null;
const h=new History({capture:()=>value,restore:v=>value=v,scope:()=>scope});
h.begin(); for(let i=1;i<=20;i++){value=i;h.checkpoint();} h.end();
assert.equal(h.undo.length,1); h.move(); assert.equal(value,0); h.move(true); assert.equal(value,20);
h.move(); value=7;h.checkpoint(); assert.equal(h.redo.length,0);
const csv={}; scope=csv; assert.equal(h.move(),false); value=9;h.checkpoint();h.move();assert.equal(value,7);assert.equal(h.move(),false);
scope=null;h.move();assert.equal(value,0);
h.reset();for(let i=1;i<=105;i++){value=i;h.checkpoint();}assert.equal(h.undo.length,100);for(let i=0;i<100;i++)h.move();assert.equal(value,5);
h.reset();assert.equal(h.move(),false);
for(const [key,shift,expected] of [['z',false,'undo'],['z',true,'redo'],['y',false,'redo']]) {
 assert.equal(shortcut({ctrlKey:true,key,shiftKey:shift,target:{closest:()=>null}}),expected);
 assert.equal(shortcut({ctrlKey:true,key,shiftKey:shift,target:{closest:()=>({})}}),null);
}
console.log('PASS history grouping, redo invalidation, cap, scope and keyboard routing');
