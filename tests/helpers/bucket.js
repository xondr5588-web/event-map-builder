export class Bucket {
  constructor() {
    this.data = new Map();
    this.serial = 0;
  }
  async get(key) {
    const v = this.data.get(key);
    return v
      ? {
          key,
          ...v,
          json: async () => JSON.parse(v.body),
          text: async () => v.body,
        }
      : null;
  }
  async put(key, body, options = {}) {
    const old = this.data.get(key),
      condition = options.onlyIf;
    if (condition?.etagMatches && old?.etag !== condition.etagMatches)
      return null;
    if (condition?.etagDoesNotMatch === "*" && old) return null;
    const value = {
      body: String(body),
      etag: `etag-${++this.serial}`,
      customMetadata: options.customMetadata || {},
    };
    this.data.set(key, value);
    return value;
  }
  async list({ prefix = "", limit = 1000 } = {}) {
    const all = [...this.data].filter(([k]) => k.startsWith(prefix));
    return {
      objects: all.slice(0, limit).map(([key, v]) => ({ key, ...v })),
      truncated: all.length > limit,
    };
  }
  async delete(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
  }
}
