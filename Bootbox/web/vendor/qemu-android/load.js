
  var Module = typeof Module != 'undefined' ? Module : {};

  Module['expectedDataFileDownloads'] ??= 0;
  Module['expectedDataFileDownloads']++;
  (() => {
    // Do not attempt to redownload the virtual filesystem data when in a pthread or a Wasm Worker context.
    var isPthread = typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD;
    var isWasmWorker = typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER;
    if (isPthread || isWasmWorker) return;
    function loadPackage(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'qemu-system-x86_64.data';
      var REMOTE_PACKAGE_BASE = 'qemu-system-x86_64.data';
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
      var REMOTE_PACKAGE_SIZE = metadata['remote_package_size']
      // Bootbox: an expanded pack served with Range support is read on demand (vendor/qemu/lazypack.js)
      // instead of fetched whole into page memory; otherwise the stock whole-pack fetch below runs.
      var lazyProbe = (typeof self !== 'undefined' && typeof window !== 'undefined' && self.BootboxLazyPack) ? self.BootboxLazyPack.probe(REMOTE_PACKAGE_NAME) : Promise.resolve(false);;

      function stage(message) {
        try { Module['bootboxStage']?.(message); } catch (_) {}
      }

      function fetchRemotePackage(packageName, packageSize, callback, errback) {
        stage('Opening local Android package…');
        Module['dataFileDownloads'] ??= {};
        fetch(packageName)
          .catch((cause) => Promise.reject(new Error(`Network Error: ${packageName}`, {cause}))) // If fetch fails, rewrite the error to include the failing URL & the cause.
          .then((response) => {
            if (!response.ok) {
              return Promise.reject(new Error(`${response.status}: ${response.url}`));
            }

            stage('Package response received; reading ' + packageSize + ' bytes…');

            if (!response.body && response.arrayBuffer) { // If we're using the polyfill, readers won't be available...
              return response.arrayBuffer().then((data) => { stage('Package received; preparing Android filesystem…'); callback(data); });
            }

            const reader = response.body.getReader();
            const iterate = () => reader.read().then(handleChunk).catch((cause) => {
              return Promise.reject(new Error(`Unexpected error while handling : ${response.url} ${cause}`, {cause}));
            });

            // Stream each packaged file into its OWN buffer rather than one buffer for the
            // whole ~2.2 GB package: a single allocation that size fails outright on
            // Chromium (its ArrayBuffer allocator caps one block just under 2 GiB) and is a
            // fragile, peak-memory-heavy request on iPad WebKit. Per-file buffers keep the
            // largest single allocation to vm.state (~1.3 GB), and let a file be released
            // on its own once QEMU no longer needs it. Sizes come from the metadata, never
            // Content-Length (that is the .gz size when LocalServer sends Content-Encoding),
            // so streamed decompression still writes every byte exactly once.
            const files = metadata['files'].slice().sort((a, b) => a.start - b.start);
            const total = packageSize;
            let parts;
            try {
              let expect = 0;
              parts = files.map((f) => {
                if (f.start !== expect) throw new Error('package files are not contiguous at ' + f.filename);
                expect = f.end;
                return new Uint8Array(f.end - f.start);
              });
              if (expect !== total) throw new Error('package metadata covers ' + expect + ' of ' + total + ' bytes');
            } catch (cause) {
              throw new Error('Bootbox could not reserve memory for the Android package (' + total + ' bytes). ' + cause);
            }
            let loaded = 0;
            let fi = 0;   // index of the file the next incoming byte belongs to
            let lastPct = -1;   // progress is reported per whole percent, not per chunk

            const handleChunk = ({done, value}) => {
              if (!done) {
                let off = 0;
                while (off < value.length && fi < files.length) {   // a chunk may span file boundaries
                  const buf = parts[fi];
                  const pos = loaded - files[fi].start;
                  const n = Math.min(value.length - off, buf.length - pos);
                  buf.set(value.subarray(off, off + n), pos);
                  off += n;
                  loaded += n;
                  if (loaded >= files[fi].end) fi++;
                }
                Module['dataFileDownloads'][packageName] = {loaded, total};

                // Report at most once per whole percent. Per-chunk reporting meant tens of
                // thousands of status/DOM/console updates while 2+ GB streamed in, all on
                // the main thread the load itself runs on.
                const pct = Math.floor(loaded * 100 / total);
                if (pct !== lastPct) {
                  lastPct = pct;
                  let totalLoaded = 0;
                  let totalSize = 0;
                  for (const download of Object.values(Module['dataFileDownloads'])) {
                    totalLoaded += download.loaded;
                    totalSize += download.total;
                  }
                  Module['setStatus']?.(`Downloading data... (${totalLoaded}/${totalSize})`);
                }
                return iterate();
              } else {
                // This completion callback must run in the fetch task itself.
                // WKWebView can throttle a deferred timer while this large ArrayBuffer
                // is retained, leaving the guest permanently at “Preparing…”.
                stage('Package received (' + loaded + ' bytes); mounting Android files…');
                if (loaded !== total) {
                  throw new Error('Android package truncated: received ' + loaded + ' of ' + total + ' bytes');
                }
                const out = {files, parts};
                parts = null;   // drop this closure's references so a file's buffer can be freed later
                callback(out);
              }
            };

            Module['setStatus']?.('Downloading data...');
            return iterate();
          })
          .catch((cause) => { errback(cause); });
      };

      function handleError(error) {
        console.error('package error:', error);
        const message = (error && error.message) || String(error);
        stage('ANDROID PACKAGE ERROR: ' + message);
        Module['setStatus']?.('Android package failed: ' + message);
      };

      var fetchedCallback = null;
      var fetched = Module['getPreloadedPackage'] ? Module['getPreloadedPackage'](REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE) : null;

      if (!fetched) lazyProbe.then((lazy) => lazy || fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, (data) => {
        if (fetchedCallback) {
          fetchedCallback(data);
          fetchedCallback = null;
        } else {
          fetched = data;
        }
      }, handleError));

    function stockRunWithFS(Module) {

      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
Module['FS_createPath']("/", "pack", true, true);

      /** @constructor */
      function DataRequest(start, end, audio) {
        this.start = start;
        this.end = end;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          this.requests[name] = this;
          Module['addRunDependency'](`fp ${this.name}`);
        },
        send: function() {},
        onload: function() {
          this.finish(this.byteArray);   // this request's own buffer (see processPackageData)
          this.byteArray = null;
        },
        finish: function(byteArray) {
          var that = this;
          // canOwn this data in the filesystem, it is a slide into the heap that will never change
          Module['FS_createDataFile'](this.name, null, byteArray, true, true, true);
          stage('Mounted ' + this.name + ' (' + byteArray.byteLength + ' bytes)');
          Module['removeRunDependency'](`fp ${that.name}`);
          this.requests[this.name] = null;
        }
      };

      var files = metadata['files'];
      for (var i = 0; i < files.length; ++i) {
        new DataRequest(files[i]['start'], files[i]['end'], files[i]['audio'] || 0).open('GET', files[i]['filename']);
      }

      function processPackageData(data) {
        assert(data, 'Loading data file failed.');
        stage('Registering Android system image in QEMU filesystem…');
        Module['setStatus']?.('Registering Android system image…');
        // data is {files, parts} (per-file buffers from the streamed fetch) or, on the
        // polyfill / preloaded paths, one ArrayBuffer that is viewed per file.
        var byFile = {};
        if (data instanceof ArrayBuffer) {
          metadata['files'].forEach(function(f) { byFile[f.filename] = new Uint8Array(data, f.start, f.end - f.start); });
        } else {
          data.files.forEach(function(f, i) { byFile[f.filename] = data.parts[i]; });
        }
          var files = metadata['files'];
          for (var i = 0; i < files.length; ++i) {
            var req = DataRequest.prototype.requests[files[i].filename];
            req.byteArray = byFile[files[i].filename];
            req.onload();
          }
          releaseSnapshotAfterIncoming();
          stage('All Android files mounted; starting QEMU…');
          Module['setStatus']?.('Android system image ready — starting QEMU…');
          Module['removeRunDependency']('datafile_qemu-system-x86_64.data');

      };

      // The warm snapshot (~1.3 GB) is read exactly once, by QEMU's `-incoming`, into
      // guest RAM — yet it would otherwise stay pinned in page memory for the whole
      // session. Unlink it the moment QEMU opens it: like POSIX, the open stream keeps
      // the data readable until QEMU closes it after the load, and nothing else holds a
      // reference (each file has its own buffer), so the garbage collector then frees
      // it. That cuts the Android guest's steady-state footprint by ~1.3 GB on the iPad.
      function releaseSnapshotAfterIncoming() {
        var FS = Module['FS'];
        var SNAP = '/pack/vm.state';
        if (!FS || typeof FS.open !== 'function' || typeof FS.unlink !== 'function') return;
        var open = FS.open;
        FS.open = function(path) {
          var stream = open.apply(this, arguments);
          if (path === SNAP) {
            FS.open = open;   // one-shot: restore the original
            try { FS.unlink(SNAP); stage('Snapshot opened by QEMU; releasing its memory after the resume'); }
            catch (e) { console.warn('could not release ' + SNAP, e); }
          }
          return stream;
        };
      }
      Module['addRunDependency']('datafile_qemu-system-x86_64.data');

      Module['preloadResults'] ??= {};

      Module['preloadResults'][PACKAGE_NAME] = {fromCache: false};
      if (fetched) {
        processPackageData(fetched);
        fetched = null;
      } else {
        fetchedCallback = processPackageData;
      }

    }
    function runWithFS(Module) {
      Module['addRunDependency']('lazy_datafile_qemu-system-x86_64.data');
      lazyProbe.then((lazy) => {
        if (!lazy) { stockRunWithFS(Module); Module['removeRunDependency']('lazy_datafile_qemu-system-x86_64.data'); return; }
        Module['setStatus']?.('Reading the guest disk from storage (on demand)…');
        Module['FS_createPath']('/', 'pack', true, true);
        self.BootboxLazyPack.install(Module, REMOTE_PACKAGE_NAME, metadata['files']).then(
          () => Module['removeRunDependency']('lazy_datafile_qemu-system-x86_64.data'),
          (e) => { console.error('lazy pack:', e); Module['setStatus']?.('Guest pack read failed: ' + ((e && e.message) || e)); });
      });
    }
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      (Module['preRun'] ??= []).push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/pack/Image", "start": 0, "end": 38724096}, {"filename": "/pack/efi-virtio.rom", "start": 38724096, "end": 38884864}, {"filename": "/pack/initrd.gz", "start": 38884864, "end": 39543381}, {"filename": "/pack/rootfs.bin", "start": 39543381, "end": 691343957}, {"filename": "/pack/userdata.qcow2", "start": 691343957, "end": 907678293}, {"filename": "/pack/vm.state", "start": 907678293, "end": 2195540803}], "remote_package_size": 2195540803});

  })();
