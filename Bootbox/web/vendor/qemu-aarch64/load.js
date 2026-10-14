
  var Module = typeof Module != 'undefined' ? Module : {};

  Module['expectedDataFileDownloads'] ??= 0;
  Module['expectedDataFileDownloads']++;
  (() => {
    // Do not attempt to redownload the virtual filesystem data when in a pthread or a Wasm Worker context.
    var isPthread = typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD;
    var isWasmWorker = typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER;
    if (isPthread || isWasmWorker) return;
    var isNode = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
    function loadPackage(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'qemu-system-aarch64.data';
      var REMOTE_PACKAGE_BASE = 'qemu-system-aarch64.data';
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
var REMOTE_PACKAGE_SIZE = metadata['remote_package_size']
      // Bootbox: an expanded pack served with Range support is read on demand (vendor/qemu/lazypack.js)
      // instead of fetched whole into page memory; otherwise the stock whole-pack fetch below runs.
      var lazyProbe = (typeof self !== 'undefined' && typeof window !== 'undefined' && self.BootboxLazyPack) ? self.BootboxLazyPack.probe(REMOTE_PACKAGE_NAME) : Promise.resolve(false);;

      function fetchRemotePackage(packageName, packageSize, callback, errback) {
        if (isNode) {
          require('fs').readFile(packageName, (err, contents) => {
            if (err) {
              errback(err);
            } else {
              callback(contents.buffer);
            }
          });
          return;
        }
        Module['dataFileDownloads'] ??= {};
        fetch(packageName)
          .catch((cause) => Promise.reject(new Error(`Network Error: ${packageName}`, {cause}))) // If fetch fails, rewrite the error to include the failing URL & the cause.
          .then((response) => {
            if (!response.ok) {
              return Promise.reject(new Error(`${response.status}: ${response.url}`));
            }

            if (!response.body && response.arrayBuffer) { // If we're using the polyfill, readers won't be available...
              return response.arrayBuffer().then(callback);
            }

            const reader = response.body.getReader();
            const iterate = () => reader.read().then(handleChunk).catch((cause) => {
              return Promise.reject(new Error(`Unexpected error while handling : ${response.url} ${cause}`, {cause}));
            });

            // Bootbox: stream each chunk straight into ONE buffer sized from the package
            // metadata (the uncompressed size; Content-Length is the .gz size when
            // LocalServer sends Content-Encoding: gzip). The stock loader kept every chunk
            // and copied them all into a second buffer at the end — 2x the package in
            // memory at the worst moment for the iPad. Progress is reported once per whole
            // percent instead of per chunk (tens of thousands of main-thread updates).
            const headers = response.headers;
            const total = packageSize > 0 ? packageSize : Number(headers.get('Content-Length') || 0);
            let packageData = new Uint8Array(total);
            let loaded = 0;
            let lastPct = -1;

            const handleChunk = ({done, value}) => {
              if (!done) {
                if (loaded + value.length > packageData.length) {   // more than expected: grow (amortized)
                  const grown = new Uint8Array(Math.max(loaded + value.length, packageData.length * 2, 1 << 20));
                  grown.set(packageData.subarray(0, loaded));
                  packageData = grown;
                }
                packageData.set(value, loaded);
                loaded += value.length;
                Module['dataFileDownloads'][packageName] = {loaded, total};

                const pct = total > 0 ? Math.floor(loaded * 100 / total) : -1;
                if (pct !== lastPct || pct < 0) {
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
                callback(loaded === packageData.length ? packageData.buffer : packageData.slice(0, loaded).buffer);
              }
            };

            Module['setStatus']?.('Downloading data...');
            return iterate();
          });
      };

      function handleError(error) {
        console.error('package error:', error);
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
          var byteArray = this.byteArray.subarray(this.start, this.end);
          this.finish(byteArray);
        },
        finish: function(byteArray) {
          var that = this;
          // canOwn this data in the filesystem, it is a slide into the heap that will never change
          Module['FS_createDataFile'](this.name, null, byteArray, true, true, true);
          Module['removeRunDependency'](`fp ${that.name}`);
          this.requests[this.name] = null;
        }
      };

      var files = metadata['files'];
      for (var i = 0; i < files.length; ++i) {
        new DataRequest(files[i]['start'], files[i]['end'], files[i]['audio'] || 0).open('GET', files[i]['filename']);
      }

      function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer.constructor.name === ArrayBuffer.name, 'bad input to processPackageData');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          DataRequest.prototype.byteArray = byteArray;
          var files = metadata['files'];
          for (var i = 0; i < files.length; ++i) {
            DataRequest.prototype.requests[files[i].filename].onload();
          }          Module['removeRunDependency']('datafile_qemu-system-aarch64.data');

      };
      Module['addRunDependency']('datafile_qemu-system-aarch64.data');

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
      Module['addRunDependency']('lazy_datafile_qemu-system-aarch64.data');
      lazyProbe.then((lazy) => {
        if (!lazy) { stockRunWithFS(Module); Module['removeRunDependency']('lazy_datafile_qemu-system-aarch64.data'); return; }
        Module['setStatus']?.('Reading the guest disk from storage (on demand)…');
        Module['FS_createPath']('/', 'pack', true, true);
        self.BootboxLazyPack.install(Module, REMOTE_PACKAGE_NAME, metadata['files']).then(
          () => Module['removeRunDependency']('lazy_datafile_qemu-system-aarch64.data'),
          (e) => { console.error('lazy pack:', e); Module['setStatus']?.('Guest pack read failed: ' + ((e && e.message) || e)); });
      });
    }
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      (Module['preRun'] ??= []).push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/pack/bzImage", "start": 0, "end": 8268288}, {"filename": "/pack/edk2-aarch64-code.fd", "start": 8268288, "end": 75377152}, {"filename": "/pack/efi-virtio.rom", "start": 75377152, "end": 75537920}, {"filename": "/pack/rootfs.bin", "start": 75537920, "end": 173803008}, {"filename": "/pack/vm.state", "start": 173803008, "end": 265519785}], "remote_package_size": 265519785});

  })();

