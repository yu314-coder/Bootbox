/* ============================================================================
 * VFS — MiniOS virtual filesystem.
 *
 * A single JSON tree persisted through the Files bridge (host-backed on device,
 * localStorage in the browser). Paths look like /Desktop/notes.txt.
 * Nodes: { type:"dir", children:{} }  or  { type:"file", content:"", mime }
 * ========================================================================== */
(function () {
  const DISK_KEY = "vfs.tree.v1";

  const defaultTree = () => ({
    type: "dir", children: {
      "Desktop":   { type: "dir", children: {
        "Welcome.txt": { type: "file", mime: "text/plain",
          content: "Welcome to MiniOS!\n\nThis is a tiny Windows-10-style desktop running\ninside the iPad host app. Open the Terminal and type `help`.\n\nEverything you do here is sandboxed and bridged to iPadOS." } } },
      "Documents": { type: "dir", children: {} },
      "Downloads": { type: "dir", children: {} },
      "Apps":      { type: "dir", children: {} },
      "Trash":     { type: "dir", children: {} },
    },
  });

  let tree = defaultTree();

  const VFS = {
    async load() {
      try {
        const raw = await Bridge.call("files", "read", { key: DISK_KEY });
        if (raw) tree = JSON.parse(raw);
      } catch (e) { /* fresh disk */ }
      return tree;
    },
    _saveTimer: null,
    save() {
      // Debounced: coalesce bursts of writes into one host round-trip.
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(async () => {
        try { await Bridge.call("files", "write", { key: DISK_KEY, value: JSON.stringify(tree) }); }
        catch (e) { console.warn("vfs save failed", e); }
      }, 250);
    },
    _resolve(path, createDirs) {
      const parts = path.split("/").filter(Boolean);
      let node = tree;
      for (let i = 0; i < parts.length; i++) {
        if (node.type !== "dir") return null;
        let next = node.children[parts[i]];
        if (!next) {
          if (!createDirs) return null;
          next = { type: "dir", children: {} };
          node.children[parts[i]] = next;
        }
        node = next;
      }
      return node;
    },
    list(path) {
      const node = this._resolve(path);
      if (!node || node.type !== "dir") return [];
      return Object.entries(node.children).map(([name, n]) => ({
        name, type: n.type, mime: n.mime, size: n.content ? n.content.length : 0,
      }));
    },
    read(path) {
      const node = this._resolve(path);
      return node && node.type === "file" ? node.content : null;
    },
    write(path, content, mime = "text/plain") {
      const parts = path.split("/").filter(Boolean);
      const name = parts.pop();
      const dir = this._resolve("/" + parts.join("/"), true);
      if (!dir || dir.type !== "dir") return false;
      dir.children[name] = { type: "file", content, mime };
      this.save();
      return true;
    },
    mkdir(path) {
      const node = this._resolve(path, true);
      this.save();
      return !!node;
    },
    remove(path) {
      const parts = path.split("/").filter(Boolean);
      const name = parts.pop();
      const dir = this._resolve("/" + parts.join("/"));
      if (!dir || !dir.children[name]) return false;
      delete dir.children[name];
      this.save();
      return true;
    },
    exists(path) { return !!this._resolve(path); },
    isDir(path) { const n = this._resolve(path); return !!n && n.type === "dir"; },
  };

  window.VFS = VFS;
})();
