(function (root) {
  'use strict';
  function equal(a, b) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a,b);
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
      if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
      const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength), y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
      for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;
      return true;
    }
    if(Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
  }
  function snapshotBuffer(previous, current) {
    return previous && equal(previous,current) ? previous : current.slice();
  }
  class History {
    constructor({ capture, restore, equal: compare = equal, scope = () => null, changed = () => {}, limit = 100 }) {
      Object.assign(this, { capture, restore, equal: compare, scope, changed, limit });
      this.held = false; this.restoring = false; this.reset();
    }
    reset() {
      this.undo = []; this.redo = []; this.current = this.capture(); this.held = false;
    }
    checkpoint() {
      if (this.held || this.restoring) return;
      const next = this.capture();
      if (this.equal(this.current, next)) return;
      this.undo.push({ before: this.current, after: next, scope: this.scope() });
      if (this.undo.length > this.limit) this.undo.shift();
      this.current = next; this.redo = []; this.changed();
    }
    begin() { this.checkpoint(); this.held = true; }
    end() { this.held = false; this.checkpoint(); }
    available(redo = false) {
      const entries = redo ? this.redo : this.undo, entry = entries[entries.length - 1];
      return !!entry && (this.scope() === null || entry.scope === this.scope());
    }
    move(redo = false) {
      if (this.held || this.restoring) return false;
      this.checkpoint();
      if (!this.available(redo)) return false;
      const from = redo ? this.redo : this.undo, to = redo ? this.undo : this.redo;
      const entry = from[from.length - 1], target = redo ? entry.after : entry.before;
      this.restoring = true;
      try { this.restore(target); this.current = this.capture(); }
      finally { this.restoring = false; }
      from.pop(); to.push(entry); this.changed(); return true;
    }
  }
  function shortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return null;
    if (event.target.closest('input:not([type="range"]), textarea, [contenteditable]:not([contenteditable="false"])')) return null;
    const key = event.key.toLowerCase();
    return key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : null;
  }
  const api = { History, shortcut, equal, snapshotBuffer };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FluixerHistory = api;
})(typeof window === 'undefined' ? {} : window);
