// src/server.js
'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const path    = require('path');

const { refreshNews, getCache, getSources } = require('./scraper');
const { preMatch, generateInsight }         = require('./intelligence');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
// IMPORTANTE: express.json() ANTES de cualquier ruta POST
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Garantizar que las rutas /api/* SIEMPRE devuelven JSON, nunca HTML
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// ── API: Noticias ─────────────────────────────────────────────────────────────
app.get('/api/news', (req, res) => {
  try {
    const { q, category, limit = 80 } = req.query;
    const cache = getCache();
    let items = [...cache.items];

    if (q) {
      const query = q.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(query) ||
        (i.summary || '').toLowerCase().includes(query) ||
        i.source.toLowerCase().includes(query)
      );
    }
    if (category && category !== 'all') {
      items = items.filter(i => i.category === category);
    }

    res.json({
      items: items.slice(0, parseInt(limit)),
      total: items.length,
      lastUpdated: cache.lastUpdated,
      failedSources: cache.failedSources
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources', (req, res) => {
  try { res.json(getSources()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const cache = await refreshNews();
    res.json({ success: true, total: cache.items.length, lastUpdated: cache.lastUpdated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const cache = getCache();
    const categories = {}, sources = {};
    cache.items.forEach(item => {
      categories[item.category] = (categories[item.category] || 0) + 1;
      sources[item.source]      = (sources[item.source]      || 0) + 1;
    });
    res.json({
      total: cache.items.length,
      lastUpdated: cache.lastUpdated,
      categories,
      topSources: Object.entries(sources).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Clientes ─────────────────────────────────────────────────────────────
let clientsDB = [];

app.get('/api/clients', (req, res) => {
  res.json({ clients: clientsDB, total: clientsDB.length });
});

app.post('/api/clients', (req, res) => {
  try {
    const { clients } = req.body;
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: 'Se esperaba un array "clients" no vacío' });
    }
    const validated = clients
      .filter(c => c.cuit && c.nombre && c.rubro)
      .map(c => ({
        cuit:     String(c.cuit).trim(),
        nombre:   String(c.nombre).trim(),
        rubro:    String(c.rubro).trim(),
        segmento: String(c.segmento || 'PYME').trim().toUpperCase()
      }));

    if (validated.length === 0) {
      return res.status(400).json({ error: 'Ninguna fila válida. Verificá columnas: CUIT, NOMBRE, RUBRO, SEGMENTO' });
    }
    clientsDB = validated;
    res.json({ success: true, loaded: validated.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients', (req, res) => {
  clientsDB = [];
  res.json({ success: true });
});

// ── API: Match ────────────────────────────────────────────────────────────────

// Por cliente → qué noticias AR aplican
app.post('/api/match/client-to-news', async (req, res) => {
  try {
    const { cuit } = req.body;
    if (!cuit) return res.status(400).json({ error: 'cuit requerido' });

    const client = clientsDB.find(c => c.cuit === String(cuit).trim());
    if (!client) return res.status(404).json({ error: `Cliente CUIT ${cuit} no encontrado` });

    const cache    = getCache();
    const allNews  = cache.items; // ya son todas argentinas
    const candidates = allNews.filter(n => preMatch(client, n)).slice(0, 8);

    if (candidates.length === 0) return res.json({ client, matches: [] });

    const matches = await Promise.all(
      candidates.map(async news => {
        const insight = await generateInsight({ client, news, mode: 'pitch' });
        return { news, insight };
      })
    );

    const order = { ALTA: 0, MEDIA: 1, BAJA: 2 };
    matches.sort((a, b) => (order[a.insight?.relevancia] ?? 1) - (order[b.insight?.relevancia] ?? 1));

    res.json({ client, matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Por noticia → qué clientes aplican
app.post('/api/match/news-to-clients', async (req, res) => {
  try {
    const { newsId } = req.body;
    if (!newsId) return res.status(400).json({ error: 'newsId requerido' });
    if (clientsDB.length === 0) return res.status(400).json({ error: 'No hay clientes cargados' });

    const cache = getCache();
    const news  = cache.items.find(i => i.id === newsId);
    if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });

    const candidates = clientsDB.filter(c => preMatch(c, news)).slice(0, 10);
    if (candidates.length === 0) return res.json({ news, matches: [] });

    const insights = await generateInsight({ client: candidates, news, mode: 'batch' });
    const matches  = Array.isArray(insights)
      ? insights.map(insight => ({ ...insight, cliente: candidates.find(c => c.cuit === insight.cuit) || candidates[0] }))
      : [];

    res.json({ news, matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback SPA (solo para rutas no-API) ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Cron: actualizar cada 30 min ─────────────────────────────────────────────
cron.schedule('*/30 * * * *', () => {
  refreshNews().catch(err => console.error('[BINDmark] Cron error:', err.message));
});

// ── Arranque ──────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[BINDmark] Server on port ${PORT}`);
  await refreshNews().catch(err => console.error('[BINDmark] Initial load error:', err.message));
});
