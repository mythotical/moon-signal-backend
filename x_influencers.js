export function createXWatcher({ bearerToken, handles, pollMs, onSignal, onSocialVelocity }) {
  if (!bearerToken || !handles.length) {
    console.log("⚠️ X watcher disabled (missing token or handles)");
    return { start() {}, stop() {} };
  }

  let timer = null;

  async function tick() {
    // placeholder: real logic runs once token is added
    onSocialVelocity(10);
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, pollMs);
      console.log("✅ X watcher armed");
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
