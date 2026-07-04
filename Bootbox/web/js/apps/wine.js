/* Windows (Wine) desktop app — launches the BoxedWine runtime to run real .exe. */
(function () {
  Apps.register({
    id: "wine", name: "Windows (Wine)", icon: "🍷", desktop: true,
    launch(args) {
      if (window.WineRuntime) WineRuntime.run(args || {});
      else Kernel.notify("Windows (Wine)", "Wine runtime not available.");
    },
  });
})();
