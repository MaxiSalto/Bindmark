// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { refreshNews, getCache, getSources } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── API Routes ────────────────────────────────────────────────────────────────

// GET /api/news — lista de noticias con filtros opcionales
app.get('/api/news', (req, res) => {
  const { q, category, region, limit = 50 } = req.query;
  const cache = getCache();
  let items = [...cache.items];

  if (q) {
    const query = q.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(query) ||
      i.summary.toLowerCase().includes(query) ||
      i.source.toLowerCase().includes(query)
    );
  }

  if (category && category !== 'all') {
    items = items.filter(i => i.category === category);
  }

  if (region && region !== 'all') {
    items = items.filter(i => i.region === region);
  }

  res.json({
    items: items.slice(0, parseInt(limit)),
    total: items.length,
    lastUpdated: cache.lastUpdated,
    failedSources: cache.failedSources
  });
});

// GET /api/sources — estado de fuentes
app.get('/api/sources', (req, res) => {
  res.json(getSources());
});

// POST /api/refresh — forzar actualización manual (Protegido para Admin)
app.post('/api/refresh', async (req, res) => {
  // 1. Extraemos la contraseña que manda el frontend en los headers
  const adminToken = req.headers['x-admin-token'];

  // 2. Comparamos con la variable de entorno
  if (!process.env.ADMIN_TOKEN || adminToken !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: 'No autorizado. Contraseña incorrecta.' });
  }

  // 3. Si es correcto, actualizamos
  try {
    const cache = await refreshNews();
    res.json({ success: true, total: cache.items.length, lastUpdated: cache.lastUpdated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats — métricas rápidas
app.get('/api/stats', (req, res) => {
  const cache = getCache();
  const categories = {};
  const regions = {};
  const sources = {};

  cache.items.forEach(item => {
    categories[item.category] = (categories[item.category] || 0) + 1;
    regions[item.region] = (regions[item.region] || 0) + 1;
    sources[item.source] = (sources[item.source] || 0) + 1;
  });

  res.json({
    total: cache.items.length,
    lastUpdated: cache.lastUpdated,
    categories,
    regions,
    topSources: Object.entries(sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))
  });
});

// Fallback → SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Cron: refresh cada 30 minutos ────────────────────────────────────────────
cron.schedule('*/30 * * * *', () => {
  refreshNews().catch(err => console.error('[BINDmark] Cron error:', err));
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[BINDmark] Server running on port ${PORT}`);
  // Carga inicial al arrancar
  await refreshNews().catch(err => console.error('[BINDmark] Initial load error:', err));
});
