// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { refreshNews, getCache, getSources } = require('./scraper');
const { preMatch, generateInsight } = require('./intelligence');

// ── In-memory clients store (persiste en RAM, se recarga con el server) ──────
let clientsDB = [];


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

// POST /api/refresh — forzar actualización manual
app.post('/api/refresh', async (req, res) => {
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

// ── CLIENTS API ───────────────────────────────────────────────────────────────

// GET /api/clients — lista clientes cargados
app.get('/api/clients', (req, res) => {
  res.json({ clients: clientsDB, total: clientsDB.length });
});

// POST /api/clients — cargar/reemplazar lista de clientes (JSON array)
app.post('/api/clients', (req, res) => {
  const { clients } = req.body;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: 'Se esperaba un array "clients"' });
  }
  // Validar campos mínimos
  const validated = clients.filter(c => c.cuit && c.nombre && c.rubro).map(c => ({
    cuit: String(c.cuit).trim(),
    nombre: String(c.nombre).trim(),
    rubro: String(c.rubro).trim(),
    segmento: String(c.segmento || 'PYME').trim()
  }));
  clientsDB = validated;
  res.json({ success: true, loaded: validated.length });
});

// DELETE /api/clients — limpiar lista
app.delete('/api/clients', (req, res) => {
  clientsDB = [];
  res.json({ success: true });
});

// POST /api/match/news-to-clients — para una noticia AR, ¿qué clientes aplican?
// Body: { newsId }
app.post('/api/match/news-to-clients', async (req, res) => {
  const { newsId } = req.body;
  if (!newsId) return res.status(400).json({ error: 'newsId requerido' });
  if (clientsDB.length === 0) return res.status(400).json({ error: 'No hay clientes cargados' });

  const cache = getCache();
  const news = cache.items.find(i => i.id === newsId && i.region === 'Argentina');
  if (!news) return res.status(404).json({ error: 'Noticia no encontrada o no es de Argentina' });

  // Pre-filtrar clientes que aplican semánticamente
  const candidates = clientsDB.filter(c => preMatch(c, news));
  if (candidates.length === 0) return res.json({ news, matches: [] });

  // Generar insights con Claude (máx 10 clientes por llamada para no saturar)
  const batch = candidates.slice(0, 10);
  const insights = await generateInsight({ client: batch, news, mode: 'batch' });

  // Combinar con datos del cliente
  const matches = Array.isArray(insights)
    ? insights.map(insight => ({
        ...insight,
        cliente: batch.find(c => c.cuit === insight.cuit) || batch[0]
      }))
    : [];

  res.json({ news, matches });
});

// POST /api/match/client-to-news — para un cliente, ¿qué noticias AR aplican?
// Body: { cuit }
app.post('/api/match/client-to-news', async (req, res) => {
  const { cuit } = req.body;
  if (!cuit) return res.status(400).json({ error: 'cuit requerido' });

  const client = clientsDB.find(c => c.cuit === String(cuit));
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  const cache = getCache();
  const arNews = cache.items.filter(i => i.region === 'Argentina');
  const candidates = arNews.filter(n => preMatch(client, n)).slice(0, 8);

  if (candidates.length === 0) return res.json({ client, matches: [] });

  // Generar insight para cada noticia candidata
  const matches = await Promise.all(
    candidates.map(async news => {
      const insight = await generateInsight({ client, news, mode: 'pitch' });
      return { news, insight };
    })
  );

  // Ordenar por relevancia
  const order = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  matches.sort((a, b) => (order[a.insight?.relevancia] ?? 1) - (order[b.insight?.relevancia] ?? 1));

  res.json({ client, matches });
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
