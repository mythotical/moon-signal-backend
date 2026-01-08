// watchers/x_influencers.js
// Safe stub watcher so the backend never crashes if X isn't configured.

export function createXWatcher({
  bearerToken,
  handles = [],
  pollMs = 20000,
  onSocialVelocity,
  onSignal
}) {
  let timer = null;

  return {
    start() {
      if (!bearerToken || !handles.length) {
        console.log("⚠️ X watcher disabled (missing token or handles)");
        return;
      }

      console.log("✅ X watcher armed (stub) — add real X polling later");
      if (timer) return;

      // Stub loop — you can replace with real X fetch later
      timer = setInterval(() => {
        // Example: could call onSocialVelocity(…) based on mentions
        // Keeping empty so it doesn't spam or break.
      }, pollMs);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
