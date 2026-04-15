// src/scraper.js — Agregador de noticias de innovación bancaria/fintech
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; BINDmark/1.0)'
  }
});

// ── Fuentes RSS de innovación bancaria y fintech ──────────────────────────────
const RSS_SOURCES = [
  {
    name: 'The Financial Brand',
    url: 'https://thefinancialbrand.com/feed/',
    category: 'Innovación Bancaria',
    region: 'Global'
  },
  {
    name: 'Finextra',
    url: 'https://www.finextra.com/rss/headlines.aspx',
    category: 'Fintech',
    region: 'Global'
  },
  {
    name: 'Banking Technology',
    url: 'https://www.bankingtech.com/feed/',
    category: 'Tecnología Bancaria',
    region: 'Global'
  },
  {
    name: 'Tearsheet',
    url: 'https://tearsheet.co/feed/',
    category: 'Fintech',
    region: 'Global'
  },
  {
    name: 'American Banker',
    url: 'https://feeds.feedburner.com/americanbanker/latestnews',
    category: 'Banca',
    region: 'USA'
  },
  {
    name: 'Finovate',
    url: 'https://finovate.com/feed/',
    category: 'Innovación',
    region: 'Global'
  },
  {
    name: 'PaymentsSource',
    url: 'https://www.paymentssource.com/rss',
    category: 'Pagos',
    region: 'Global'
  },
  {
    name: 'PYMNTS',
    url: 'https://www.pymnts.com/feed/',
    category: 'Pagos & Fintech',
    region: 'Global'
  },
  {
    name: 'iProUP Fintech',
    url: 'https://www.iproup.com/rss/fintech',
    category: 'Fintech',
    region: 'Argentina'
  },
  {
    name: 'Infobae Economía',
    url: 'https://www.infobae.com/economia/rss/',
    category: 'Banca',
    region: 'Argentina'
  }
];

// Palabras clave para filtrar solo noticias relevantes de productos bancarios/fintech
const KEYWORDS = [
  'banking', 'bank', 'fintech', 'neobank', 'digital bank',
  'payment', 'lending', 'credit card', 'debit', 'wallet',
  'open banking', 'api banking', 'embedded finance',
  'bnpl', 'buy now pay later', 'crypto', 'blockchain',
  'mobile banking', 'challenger bank', 'product launch',
  'feature', 'innovation', 'launch', 'release', 'new',
  'banca', 'banco', 'fintech', 'billetera', 'tarjeta',
  'pagos', 'crédito', 'cuenta', 'digital', 'app bancaria',
  'neobank', 'mercadopago', 'uala', 'naranja x', 'brubank',
  'cbu', 'alias', 'transferencia', 'qr', 'pos'
];

// Fuentes que no funcionaron en el último ciclo (para skip dinámico)
const failedSources = new Set();

function isRelevant(text) {
  const lower = (text || '').toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function isRecent(dateStr) {
  if (!dateStr) return true; // si no hay fecha, lo incluimos
  const itemDate = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7); // solo últimos 7 días
  return itemDate >= cutoff;
}

async function fetchFeed(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || [])
      .filter(item => isRecent(item.pubDate || item.isoDate))
      .filter(item => isRelevant(item.title + ' ' + (item.contentSnippet || '')))
      .slice(0, 15)
      .map(item => ({
        id: Buffer.from(item.link || item.title || Math.random().toString()).toString('base64').slice(0, 16),
        title: item.title || 'Sin título',
        summary: (item.contentSnippet || item.content || '').slice(0, 200).trim(),
        url: item.link || '#',
        date: item.pubDate || item.isoDate || new Date().toISOString(),
        source: source.name,
        category: source.category,
        region: source.region
      }));

    if (items.length > 0) failedSources.delete(source.name);
    return items;
  } catch (err) {
    failedSources.add(source.name);
    console.warn(`[BINDmark] Feed failed: ${source.name} — ${err.message}`);
    return [];
  }
}

// Cache en memoria
let cache = {
  items: [],
  lastUpdated: null,
  failedSources: []
};

async function refreshNews() {
  console.log('[BINDmark] Refreshing news feeds...');
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchFeed(s)));

  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicar por URL
  const seen = new Set();
  const unique = allItems.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Ordenar por fecha más reciente
  unique.sort((a, b) => new Date(b.date) - new Date(a.date));

  cache = {
    items: unique,
    lastUpdated: new Date().toISOString(),
    failedSources: Array.from(failedSources)
  };

  console.log(`[BINDmark] Loaded ${unique.length} items from ${RSS_SOURCES.length} sources`);
  return cache;
}

function getCache() {
  return cache;
}

function getSources() {
  return RSS_SOURCES.map(s => ({
    ...s,
    status: failedSources.has(s.name) ? 'error' : 'ok'
  }));
}

module.exports = { refreshNews, getCache, getSources };
