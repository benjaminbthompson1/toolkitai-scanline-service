require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool, ensureSchema } = require('./src/db');
const { sessionMiddleware } = require('./src/session');
const scanlinePagesRouter = require('./src/routes/scanline-pages');
const scanlineApiRouter = require('./src/routes/scanline-api');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', 1); // behind Traefik

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// Scanline is mounted under /scanline on the shared public hostname (see
// ARCHITECTURE.md at the platform repo for the Traefik path-routing setup),
// so its own routes are registered at the SAME paths it always used —
// nothing downstream (the dashboard's fetch calls, the exported PDF's
// Content-Disposition, etc.) needed to change when this split out of the
// monolith.
app.use('/scanline', express.static(path.join(__dirname, 'public/scanline')));

app.use(sessionMiddleware());
app.use(express.json());

// Scanline has no public/unauthenticated routes at all, so the whole API
// router gates itself in one middleware (see the top of scanline-api.js)
// rather than matching individual routes here.
app.use('/scanline/api', scanlineApiRouter);
app.use('/scanline', scanlinePagesRouter);

async function start() {
  try {
    await ensureSchema();
    console.log('Scanline database schema ready.');
  } catch (err) {
    console.error('Failed to prepare database schema:', err.message || err.code || String(err));
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
  app.listen(PORT, HOST, () => {
    console.log(`Scanline listening on ${HOST}:${PORT}`);
  });
}

start();
