// Aggregates data from various watchers such as Dexscreener, Helius, and Telegram.

class WatcherIntegration {
    constructor() {
        this.watchers = {};
    }

    addWatcher(name, watcher) {
        this.watchers[name] = watcher;
    }

    async aggregateData() {
        const dataPromises = Object.values(this.watchers).map(watcher => watcher.getData());
        const results = await Promise.all(dataPromises);
        return results;
    }

    exposeState() {
        return this.aggregateData().then(data => {
            // Process and expose the unified state
            return this.processData(data);
        });
    }

    processData(data) {
        // Example processing of aggregated data
        return data.flat(); // Flatten the results as an example
    }
}

// Add example watchers (placeholders for actual implementations)
const watcherIntegration = new WatcherIntegration();
watcherIntegration.addWatcher('dexscreener', new DexscreenerWatcher());
watcherIntegration.addWatcher('helius', new HeliusWatcher());
watcherIntegration.addWatcher('telegram', new TelegramWatcher());

module.exports = watcherIntegration;