// src/routes/signals.js

const express = require('express');
const router = express.Router();
const { checkTierGate } = require('../middleware/tierGating');
const { addWatcher, removeWatcher, getWatchers } = require('../controllers/watcherController');

// Endpoint to add a watcher
router.post('/watchers', checkTierGate, async (req, res) => {
    const { userId } = req.body;
    try {
        await addWatcher(userId);
        res.status(201).json({ message: 'Watcher added successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to remove a watcher
router.delete('/watchers/:userId', checkTierGate, async (req, res) => {
    const { userId } = req.params;
    try {
        await removeWatcher(userId);
        res.status(200).json({ message: 'Watcher removed successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get all watchers
router.get('/watchers', checkTierGate, async (req, res) => {
    try {
        const watchers = await getWatchers();
        res.status(200).json(watchers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;