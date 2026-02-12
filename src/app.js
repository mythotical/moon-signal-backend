// Importing required modules
const express = require('express');
const bodyParser = require('body-parser');

// Middleware setup
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import routes
const indexRoutes = require('./routes/index');
const userRoutes = require('./routes/users');
const tierGatedRoutes = require('./routes/tierGatedRoutes');

// Set up watcher integration (if any implementation is required)

// Apply tier gating
app.use('/api/tier-gated', tierGatedRoutes);

// General routes
app.use('/', indexRoutes);
app.use('/users', userRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

module.exports = app;