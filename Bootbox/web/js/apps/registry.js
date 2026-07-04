/* ============================================================================
 * App Registry — built-in MiniOS apps + installed .mapp packages.
 * A MiniOS app is { id, name, icon, desktop?, launch(args) }.
 * ========================================================================== */
(function () {
  const apps = new Map();

  const Apps = {
    register(app) { apps.set(app.id, app); Kernel.emit("apps:change"); },
    get(id) { return apps.get(id); },
    all() { return [...apps.values()]; },
    desktop() { return [...apps.values()].filter(a => a.desktop); },
    launch(id, args) {
      const app = apps.get(id);
      if (!app) { Kernel.notify("Error", "App not found: " + id); return; }
      Kernel.sys.haptic();
      return app.launch(args || {});
    },
  };

  window.Apps = Apps;
})();
