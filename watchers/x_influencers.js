  return {
    start() {
      if (!bearerToken || !handles.length) {
        console.log("⚠️ X watcher disabled (missing token or handles)");
        return;
      }
      console.log("✅ X watcher armed (stub)");
    },
    stop() {}
  };
}
