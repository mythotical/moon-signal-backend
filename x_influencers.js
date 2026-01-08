export function createXWatcher({ bearerToken, handles = [], pollMs = 20000, onSocialVelocity, onSignal }) {
  return {
    start() {
      if (!bearerToken || !handles.length) {
        console.log("⚠️ X watcher disabled (missing token or handles)");
        return;
      }
      console.log("✅ X watcher armed (stub) — add real implementation next");
      // leaving stub so deploy never breaks
    },
    stop() {}
  };
}
