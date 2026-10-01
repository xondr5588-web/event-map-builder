import { clone } from "./model.js";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function delta(before, after, label) {
  const a = new Map(before.objects.map((o) => [o.id, o])),
    b = new Map(after.objects.map((o) => [o.id, o]));
  const changes = [];
  for (const id of new Set([...a.keys(), ...b.keys()]))
    if (!equal(a.get(id), b.get(id)))
      changes.push({ id, before: a.get(id), after: b.get(id) });
  const meta = {};
  for (const key of ["title", "settings", "meta"])
    if (!equal(before[key], after[key]))
      meta[key] = { before: clone(before[key]), after: clone(after[key]) };
  const orderBefore = before.objects.map((o) => o.id),
    orderAfter = after.objects.map((o) => o.id);
  if (
    !changes.length &&
    !Object.keys(meta).length &&
    equal(orderBefore, orderAfter)
  )
    return null;
  return {
    label,
    changes: clone(changes),
    meta,
    ...(!equal(orderBefore, orderAfter) ? { orderBefore, orderAfter } : {}),
  };
}
export class History {
  constructor(limit = 100, maxBytes = 20 * 1024 * 1024) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
  record(before, after, label) {
    const d = delta(before, after, label);
    if (!d) return false;
    d.bytes = JSON.stringify(d).length * 2;
    this.undoStack.push(d);
    this.bytes += d.bytes;
    this.redoStack = [];
    while (
      this.undoStack.length > this.limit ||
      (this.bytes > this.maxBytes && this.undoStack.length > 1)
    )
      this.bytes -= this.undoStack.shift().bytes;
    return true;
  }
  apply(p, d, direction) {
    const out = clone(p),
      objects = new Map(out.objects.map((o) => [o.id, o]));
    for (const c of d.changes) {
      const value = c[direction];
      if (value) objects.set(c.id, clone(value));
      else objects.delete(c.id);
    }
    const order = d[direction === "before" ? "orderBefore" : "orderAfter"];
    out.objects = order
      ? order.map((id) => objects.get(id)).filter(Boolean)
      : [...objects.values()];
    for (const [k, c] of Object.entries(d.meta)) out[k] = clone(c[direction]);
    return out;
  }
  undo(p) {
    const d = this.undoStack.pop();
    if (!d) return p;
    this.bytes -= d.bytes;
    this.redoStack.push(d);
    return this.apply(p, d, "before");
  }
  redo(p) {
    const d = this.redoStack.pop();
    if (!d) return p;
    this.bytes += d.bytes;
    this.undoStack.push(d);
    return this.apply(p, d, "after");
  }
}
