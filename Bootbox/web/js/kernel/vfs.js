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
    // Saving must never happen before the disk has been read: startup code that writes to the VFS
    // early used to trigger the debounced save while `tree` was still the empty default, overwriting
    // the real disk (settings, files) - then load() read back the empty tree. Seen in the iOS app
    // when a fresh web view started (Restart after the page died). If the disk can't be read or
    // parsed, this session doesn't save at all rather than destroy it.
    _loaded: false,
    _readOnly: false,
    async load() {
      const t0 = Date.now();
      for (let attempt = 1; attempt <= 3 && !this._loaded; attempt++) {
        try {
          const raw = await Bridge.call("files", "read", { key: DISK_KEY });
          if (raw) {
            try { tree = JSON.parse(raw); }
            catch (e) { this._readOnly = true; console.warn("[vfs] disk unreadable (" + e + "): not saving this session"); }
          }
          this._loaded = true;
          console.log("[vfs] loaded " + (raw ? raw.length + " bytes" : "nothing (fresh disk)") + " in " + (Date.now() - t0) + " ms");
        } catch (e) { console.warn("[vfs] load attempt " + attempt + " failed after " + (Date.now() - t0) + " ms: " + e); }
      }
      if (!this._loaded) { this._loaded = true; this._readOnly = true; console.warn("[vfs] could not read the disk: not saving this session"); }
      return tree;
    },
    _saveTimer: null,
    save() {
      if (!this._loaded || this._readOnly) return;   // see above
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
