(function (root) {
  'use strict';
  class History {
    constructor({ capture, restore, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b), scope = () => null, changed = () => {}, limit = 100 }) {
      Object.assign(this, { capture, restore, equal, scope, changed, limit });
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
  const api = { History, shortcut };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FluixerHistory = api;
})(typeof window === 'undefined' ? {} : window);
