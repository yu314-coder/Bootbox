
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
      var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];

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

            const headers = response.headers;
            // Content-Length is the compressed .gz size when LocalServer serves
            // this package with Content-Encoding. Allocate from the known
            // uncompressed package size so streamed decompression writes once
            // instead of retaining hundreds of chunks and then copying them.
            const total = Math.max(packageSize, Number(headers.get('Content-Length') || 0));
            let packageData;
            try {
              packageData = new Uint8Array(total);
            } catch (cause) {
              throw new Error('Bootbox could not reserve ' + total + ' bytes for the Android package. ' + cause);
            }
            let loaded = 0;

            const handleChunk = ({done, value}) => {
              if (!done) {
                packageData.set(value, loaded);
                loaded += value.length;
                Module['dataFileDownloads'][packageName] = {loaded, total};

                let totalLoaded = 0;
                let totalSize = 0;

                for (const download of Object.values(Module['dataFileDownloads'])) {
                  totalLoaded += download.loaded;
                  totalSize += download.total;
                }

                Module['setStatus']?.(`Downloading data... (${totalLoaded}/${totalSize})`);
                return iterate();
              } else {
                // This completion callback must run in the fetch task itself.
                // WKWebView can throttle a deferred timer while this large ArrayBuffer
                // is retained, leaving the guest permanently at “Preparing…”.
                stage('Package received (' + loaded + ' bytes); mounting Android files…');
                callback(loaded === packageData.length ? packageData.buffer : packageData.slice(0, loaded).buffer);
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

      if (!fetched) fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, (data) => {
        if (fetchedCallback) {
          fetchedCallback(data);
          fetchedCallback = null;
        } else {
          fetched = data;
        }
      }, handleError);

    function runWithFS(Module) {

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
          stage('Mounted ' + this.name + ' (' + byteArray.byteLength + ' bytes)');
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
        stage('Registering Android system image in QEMU filesystem…');
        Module['setStatus']?.('Registering Android system image…');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          DataRequest.prototype.byteArray = byteArray;
          var files = metadata['files'];
          for (var i = 0; i < files.length; ++i) {
            DataRequest.prototype.requests[files[i].filename].onload();
          }
          stage('All Android files mounted; starting QEMU…');
          Module['setStatus']?.('Android system image ready — starting QEMU…');
          Module['removeRunDependency']('datafile_qemu-system-x86_64.data');

      };
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
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      (Module['preRun'] ??= []).push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/pack/bios-256k.bin", "start": 0, "end": 262144}, {"filename": "/pack/bzImage", "start": 262144, "end": 4625888}, {"filename": "/pack/efi-virtio.rom", "start": 4625888, "end": 4786656}, {"filename": "/pack/kvmvapic.bin", "start": 4786656, "end": 4795872}, {"filename": "/pack/linuxboot_dma.bin", "start": 4795872, "end": 4797408}, {"filename": "/pack/rootfs.bin", "start": 4797408, "end": 618580960}, {"filename": "/pack/userdata.qcow2", "start": 618580960, "end": 622942688}, {"filename": "/pack/vgabios-stdvga.bin", "start": 622942688, "end": 622982112}], "remote_package_size": 622982112});

  })();
