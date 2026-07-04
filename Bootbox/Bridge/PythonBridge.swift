import Foundation

/// Native CPython bridge for MiniOS, built to run on top of
/// **yu314-coder/python-ios-lib** (BeeWare Python.xcframework + ~180 bundled
/// packages). It loads libpython at runtime via dlopen — so the app still
/// COMPILES whether or not the framework is embedded; Python just stays
/// "unavailable" until you add the framework per INTEGRATION_PYTHON.md.
///
/// Guest -> host:  python/run {code}, python/exec {path}, python/pip {pkg}, python/status
final class PythonBridge {
    private var handle: UnsafeMutableRawPointer?
    private var ready = false
    private var booting = false

    // C entry points resolved from the embedded Python.framework.
    private typealias VoidFn = @convention(c) () -> Void
    private typealias IntFn  = @convention(c) () -> Int32
    private typealias StrFn  = @convention(c) (UnsafePointer<CChar>?) -> Int32
    private var pyInitialize: VoidFn?
    private var pyIsInit: IntFn?
    private var pyRunSimpleString: StrFn?

    private var outFile: String { NSTemporaryDirectory() + "minios_py_out.txt" }
    private var codeFile: String { NSTemporaryDirectory() + "minios_user.py" }

    func handle(_ action: String, _ payload: [String: Any], _ respond: @escaping (Bool, Any?) -> Void) {
        switch action {
        case "status":
            respond(true, ["available": bootIfNeeded(), "engine": "native CPython (python-ios-lib)"])
        case "run":
            guard let code = payload["code"] as? String else { return respond(false, "missing code") }
            runCode(code, respond)
        case "exec":
            guard let path = payload["path"] as? String, let code = try? String(contentsOfFile: path) else {
                return respond(false, "cannot read file")
            }
            runCode(code, respond)
        case "pip":
            // Native offline build ships packages prebundled; report that.
            let pkg = payload["pkg"] as? String ?? ""
            runCode("import importlib.util as u\nprint('\(pkg): ' + ('already bundled' if u.find_spec('\(pkg)') else 'not in offline bundle — add it to app_packages'))", respond)
        default:
            respond(false, "unknown python action: \(action)")
        }
    }

    // MARK: - boot
    @discardableResult
    private func bootIfNeeded() -> Bool {
        if ready { return true }
        if booting { return false }
        booting = true

        // Locate the embedded Python dylib (BeeWare framework).
        let fw = Bundle.main.bundleURL.appendingPathComponent("Frameworks/Python.framework/Python")
        handle = dlopen(fw.path, RTLD_NOW | RTLD_GLOBAL) ?? dlopen("Python", RTLD_NOW) ?? dlopen(nil, RTLD_NOW)
        guard let h = handle,
              let initSym = dlsym(h, "Py_Initialize"),
              let isInitSym = dlsym(h, "Py_IsInitialized"),
              let runSym = dlsym(h, "PyRun_SimpleString") else {
            booting = false
            return false   // framework not present — Python unavailable
        }
        pyInitialize = unsafeBitCast(initSym, to: VoidFn.self)
        pyIsInit = unsafeBitCast(isInitSym, to: IntFn.self)
        pyRunSimpleString = unsafeBitCast(runSym, to: StrFn.self)

        if pyIsInit?() == 0 { setupEnvAndInit() }
        ready = (pyIsInit?() != 0)
        booting = false
        return ready
    }

    private func setupEnvAndInit() {
        let bundleURL = Bundle.main.bundleURL
        let stdlib = bundleURL.appendingPathComponent("python-stdlib")
        let dynload = stdlib.appendingPathComponent("lib-dynload")
        var libBundles: [String] = []
        if let entries = try? FileManager.default.contentsOfDirectory(atPath: bundleURL.path) {
            for n in entries where n.hasPrefix("python-ios-lib_") && n.hasSuffix(".bundle") {
                libBundles.append(bundleURL.appendingPathComponent(n).path)
            }
        }
        let pythonPath = ([stdlib.path, dynload.path] + libBundles).joined(separator: ":")
        setenv("PYTHONHOME", stdlib.path, 1)
        setenv("PYTHONPATH", pythonPath, 1)
        setenv("PYTHONNOUSERSITE", "1", 1)
        setenv("PYTHONDONTWRITEBYTECODE", "1", 1)
        setenv("PYTHONMALLOC", "malloc", 1)
        setenv("TMPDIR", NSTemporaryDirectory(), 1)
        #if targetEnvironment(simulator)
        setenv("_PYTHON_SYSCONFIGDATA_NAME", "_sysconfigdata__ios_arm64-iphonesimulator", 1)
        #else
        setenv("_PYTHON_SYSCONFIGDATA_NAME", "_sysconfigdata__ios_arm64-iphoneos", 1)
        #endif
        pyInitialize?()
    }

    // MARK: - run with stdout capture
    private func runCode(_ code: String, _ respond: @escaping (Bool, Any?) -> Void) {
        guard bootIfNeeded(), let run = pyRunSimpleString else {
            return respond(false, "Python runtime not available — add Python.xcframework (see INTEGRATION_PYTHON.md)")
        }
        DispatchQueue.global(qos: .userInitiated).async {
            try? code.write(toFile: self.codeFile, atomically: true, encoding: .utf8)
            try? "".write(toFile: self.outFile, atomically: true, encoding: .utf8)
            // Runner: exec the user file with stdout+stderr captured to a temp file.
            let runner = """
            import sys, io, traceback
            _b = io.StringIO()
            _o, _e = sys.stdout, sys.stderr
            sys.stdout = sys.stderr = _b
            try:
                exec(compile(open(r"\(self.codeFile)").read(), "<minios>", "exec"), {"__name__": "__main__"})
            except SystemExit:
                pass
            except Exception:
                traceback.print_exc()
            finally:
                sys.stdout, sys.stderr = _o, _e
                open(r"\(self.outFile)", "w").write(_b.getvalue())
            """
            _ = runner.withCString { run($0) }
            let out = (try? String(contentsOfFile: self.outFile)) ?? ""
            DispatchQueue.main.async { respond(true, ["output": out]) }
        }
    }
}
