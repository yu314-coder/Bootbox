# Native Python in MiniOS (python-ios-lib)

MiniOS already ships a **working Python in the Terminal**:

- **In the browser / dev preview** → real CPython via **Pyodide** (WASM), loaded on
  first `python` use. `python -c "..."`, `python file.py`, `pip install <pkg>`,
  `curl`, `wget` all work.
- **On device** → MiniOS prefers a **native CPython 3.14** runtime from
  [yu314-coder/python-ios-lib](https://github.com/yu314-coder/python-ios-lib)
  (BeeWare `Python.xcframework` + ~180 bundled packages: NumPy, SciPy, sklearn,
  SymPy, Pillow, matplotlib, torch, transformers, …). If the framework isn't
  embedded yet, it automatically falls back to Pyodide.

The Swift glue is already in place — [PythonBridge.swift](MiniOS/Bridge/PythonBridge.swift)
loads `libpython` via `dlopen` (so the app builds with **or** without the
framework) and runs code with stdout/stderr capture. The Terminal calls it
through the `python` host bridge.

## To enable the full native runtime (offline, ~180 libs)

Follow the python-ios-lib README — the MiniOS-specific notes:

1. **Get BeeWare's `Python.xcframework`** (~124 MB) as described in that repo's
   "Get BeeWare's Python.xcframework" section. Drag it into the Xcode project →
   target **MiniOS** → General → Frameworks → **Embed & Sign**.

2. **Add the Swift package**: File → Add Package Dependencies →
   `https://github.com/yu314-coder/python-ios-lib` → add the products you want
   (e.g. `NumPy`, `SymPy`, `Pillow`, `Requests`, …) to the **MiniOS** target.

3. **Bundle the stdlib + site-packages** with the repo's build scripts so the
   `.app` contains `python-stdlib/` and `python-ios-lib_*.bundle` siblings
   (PythonBridge auto-discovers any `python-ios-lib_*.bundle`). Set
   **Build Settings → `ENABLE_USER_SCRIPT_SANDBOXING = NO`** for the copy phase.

4. Build settings the repo requires: `IPHONEOS_DEPLOYMENT_TARGET ≥ 17.0`
   (currently 16.0 — bump it), ExecuTorch xcframeworks → **Do Not Embed**,
   `ITSAppUsesNonExemptEncryption = false`.

`PythonBridge` already sets the required env vars (`PYTHONHOME`, `PYTHONPATH`,
`PYTHONMALLOC=malloc`, `_PYTHON_SYSCONFIGDATA_NAME` per arch) before
`Py_Initialize()`, exactly per the repo's bootstrap.

## Try it (Terminal)

```
python -c "import sys; print(sys.version)"
python -c "import numpy as np; print(np.arange(5)*2)"
pip install requests
curl https://example.com
```

## Honest limits

- **Running real `.exe` / `.apk` programs is still not possible** on stock
  iPadOS (no JIT / no arbitrary native execution — an Apple platform rule). That
  is unrelated to Python; this brings real *Python* scripting, not Windows/Android
  binary execution.
- `pip install` on device installs from the **bundled** package set (offline).
  Pure-Python wheels over the network also work where the index allows it; native
  wheels must be cross-compiled and added to `app_packages` (see the repo).
