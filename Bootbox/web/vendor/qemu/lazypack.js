/* Bootbox lazy guest pack.
 *
 * A guest pack (qemu-system-*.data) is one file holding the BIOS, kernel, ROMs, the guest disk
 * (rootfs.bin, 600-900 MB) and sometimes a RAM snapshot (Android's vm.state, 1.2 GB). Emscripten's
 * stock loader fetches the WHOLE pack into page memory before QEMU starts - up to 1.9 GB of
 * JavaScript memory on top of the engine's heap. On an iPad that transfer died with
 * "TypeError: Load failed" and the guest never booted.
 *
 * When the server can serve byte ranges of the pack (Bootbox's LocalServer once the pack has
 * been expanded on disk), this loader instead:
 *   - fetches each small file (<= SMALL bytes) with one Range request, as before into MEMFS;
 *   - turns each big file into a MEMFS node whose reads fetch 1 MB chunks on demand with a
 *     synchronous Range request, keeping at most CACHE_CHUNKS chunks (LRU). QEMU's file I/O is
 *     proxied to the page's main thread, which may do synchronous XHR; binary data comes back
 *     through the x-user-defined charset. Writes go to private copies of the touched chunks,
 *     so a writable disk behaves as before (changes last until the guest stops).
 * Anything else (a server without Range, e.g. the gzip-on-the-fly path) keeps the stock loader.
 */
(function () {
  const SMALL = 64 << 20;          // files up to this size are fetched whole
  const CHUNK = 1 << 20;           // on-demand read granularity
  const CACHE_CHUNKS = 96;         // ~96 MB of clean chunks kept in memory

  // Does `url` answer a Range request with 206? (LocalServer only does for an expanded pack.)
  async function probe(url) {
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
      const ok = r.status === 206;
      try { await r.arrayBuffer(); } catch (e) {}
      return ok;
    } catch (e) { return false; }
  }

  // One synchronous Range read [start, end), main thread or worker. Binary comes back through the
  // x-user-defined charset (byte b -> U+0000..007F or U+F780..F7FF). Text decoding sniffs a BOM BEFORE
  // honouring that charset, so a range that happens to begin with FE FF / FF FE / EF BB BF is decoded
  // as UTF-16/UTF-8 instead (seen: 524287 chars for 1 MB). Any such mis-decode is detected (length or
  // an out-of-range char) and the range re-requested starting a byte or two earlier, so it no longer
  // begins with a BOM; the extra leading bytes are dropped. (Lazy files never start at offset 0.)
  function syncRange(url, start, end) {
    for (let pre = 0; pre <= 4 && pre <= start; pre++) {
      const x = new XMLHttpRequest();
      x.open("GET", url, false);
      x.overrideMimeType("text/plain; charset=x-user-defined");
      x.setRequestHeader("Range", "bytes=" + (start - pre) + "-" + (end - 1));
      x.send(null);
      if (x.status !== 206 && x.status !== 200) throw new Error("lazy pack read HTTP " + x.status + " at " + start);
      const s = x.responseText, want = end - start + pre;
      if (s.length !== want) continue;
      const out = new Uint8Array(end - start);
      let ok = true;
      for (let i = pre; i < want; i++) {
        const c = s.charCodeAt(i);
        if (c > 0x7f && (c < 0xf780 || c > 0xf7ff)) { ok = false; break; }
        out[i - pre] = c & 0xff;
      }
      if (ok) return out;
    }
    throw new Error("lazy pack: could not read " + start + "-" + end + " as binary");
  }

  // Read progress, for the "loading…" status while a guest boots: the furthest byte read of each
  // lazy file (a RAM snapshot is read front to back) and the total fetched.
  const stats = { files: [], fetched: 0 };
  function progress() {
    const snap = stats.files.find((f) => /vm\.state$/.test(f.name));
    return { snapshot: snap ? { read: snap.top, size: snap.size } : null, fetched: stats.fetched };
  }

  // Turn MEMFS node `node` into a window [base, base + size) of the pack at `url`.
  function makeLazy(node, url, base, size, cacheChunks, name) {
    const keep = cacheChunks || CACHE_CHUNKS;
    const st = { name: name || "", size, top: 0 };
    stats.files.push(st);
    const cache = new Map();     // chunk index -> clean bytes (Map order = LRU)
    const dirty = new Map();     // chunk index -> privately written bytes (never evicted)
    const chunk = (ci) => {
      let c = dirty.get(ci);
      if (c) return c;
      c = cache.get(ci);
      if (c) { cache.delete(ci); cache.set(ci, c); return c; }
      const s = ci * CHUNK, e = Math.min(size, s + CHUNK);
      c = syncRange(url, base + s, base + e);
      stats.fetched += c.length;
      cache.set(ci, c);
      if (cache.size > keep) cache.delete(cache.keys().next().value);
      return c;
    };
    const ops = node.stream_ops;
    node.usedBytes = size;
    node.contents = null;
    node.stream_ops = Object.assign({}, ops, {
      // `buffer` is emscripten's heap view (an Int8Array): copy through a byte view of the same
      // memory so TypedArray.set is a plain memcpy, not an element-wise Int8<->Uint8 conversion.
      read(stream, buffer, offset, length, position) {
        if (position >= node.usedBytes) return 0;
        const n = Math.min(length, node.usedBytes - position);
        if (position + n > st.top) st.top = position + n;
        const dst = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, n);
        let done = 0;
        while (done < n) {
          const p = position + done, ci = Math.floor(p / CHUNK), o = p - ci * CHUNK;
          const c = chunk(ci), k = Math.min(n - done, c.length - o);
          dst.set(c.subarray(o, o + k), done);
          done += k;
        }
        return n;
      },
      write(stream, buffer, offset, length, position) {
        if (position + length > size) throw new Error("lazy pack: write past the end of " + size);
        const src = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
        let done = 0;
        while (done < length) {
          const p = position + done, ci = Math.floor(p / CHUNK), o = p - ci * CHUNK;
          let c = dirty.get(ci);
          if (!c) { c = chunk(ci).slice(); dirty.set(ci, c); cache.delete(ci); }
          const k = Math.min(length - done, c.length - o);
          c.set(src.subarray(done, done + k), o);
          done += k;
        }
        return length;
      },
      mmap() { throw new Error("lazy pack: mmap is not supported"); },
    });
  }

  // Create every file of the pack in MEMFS. Small ones are fetched now (resolves when done).
  async function install(Module, url, files) {
    const FS = Module.FS;
    await Promise.all(files.map(async (f) => {
      const size = f.end - f.start;
      const slash = f.filename.lastIndexOf("/");
      const dir = f.filename.slice(0, slash) || "/", name = f.filename.slice(slash + 1);
      if (size <= SMALL) {
        const r = await fetch(url, { headers: { Range: "bytes=" + f.start + "-" + (f.end - 1) }, cache: "no-store" });
        if (r.status !== 206) throw new Error("lazy pack: " + f.filename + " HTTP " + r.status);
        const data = new Uint8Array(await r.arrayBuffer());
        if (data.length !== size) throw new Error("lazy pack: " + f.filename + " short (" + data.length + "/" + size + ")");
        Module.FS_createDataFile(dir, name, data, true, true, true);
      } else {
        Module.FS_createDataFile(dir, name, new Uint8Array(0), true, true, true);
        // A RAM snapshot (vm.state) is read once, front to back: keep almost nothing of it cached.
        makeLazy(FS.lookupPath(f.filename).node, url, f.start, size, /vm\.state$/.test(name) ? 2 : CACHE_CHUNKS, name);
      }
    }));
  }

  self.BootboxLazyPack = { probe, install, makeLazy, progress, SMALL, CHUNK };
})();
