// src/scraper.js — Fuentes 100% argentinas de banca, fintech y productos financieros
const RSSParser = require('rss-parser');

const parser = new RSSParser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BINDmark/2.0)' }
});

// ── Fuentes argentinas ────────────────────────────────────────────────────────
const RSS_SOURCES = [
  { name: 'iProUP Fintech',        url: 'https://www.iproup.com/rss/fintech',                          category: 'Fintech AR' },
  { name: 'iProUP Economía',       url: 'https://www.iproup.com/rss/economia',                         category: 'Economía AR' },
  { name: 'Infobae Economía',      url: 'https://www.infobae.com/economia/rss/',                       category: 'Economía AR' },
  { name: 'Ámbito Financiero',     url: 'https://www.ambito.com/rss/pages/economia.xml',               category: 'Finanzas AR' },
  { name: 'El Cronista',           url: 'https://cronista.com/files/rss/economia.xml',                 category: 'Economía AR' },
  { name: 'iProfesional Finanzas', url: 'https://www.iprofesional.com/rss/finanzas.xml',               category: 'Finanzas AR' },
  { name: 'iProfesional Tech',     url: 'https://www.iprofesional.com/rss/tecnologia.xml',             category: 'Fintech AR' },
  { name: 'La Nación Economía',    url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/categoria/economia/', category: 'Economía AR' },
  { name: 'Clarín Economía',       url: 'https://www.clarin.com/rss/economia/',                        category: 'Economía AR' },
  { name: 'Télam Economía',        url: 'https://www.telam.com.ar/rss/economia.xml',                   category: 'Economía AR' }
];

// ── Keywords bancarios y fintech AR ──────────────────────────────────────────
const BANKING_KEYWORDS = [
  'crédito','préstamo','tarjeta','cuenta','caja de ahorro','cuenta corriente',
  'plazo fijo','fondo','inversión','leasing','factoring','cheque',
  'home banking','banca digital','billetera','wallet','transferencia',
  'débito','cuota','financiamiento','línea de crédito','descubierto',
  'banco','fintech','neobank','mercadopago','mercado pago','uala','ualá',
  'naranja x','brubank','wilobank','bind','galicia','santander','bbva',
  'hsbc','icbc','macro','patagonia','supervielle','ciudad','provincia',
  'nación','bapro','itaú','comafi','hipotecario',
  'bcra','banco central','tasa','tna','tea','regulación bancaria',
  'comunicación bcra','sgr','garantía','pyme','mipyme',
  'qr','pos','pago','cobro','echeq','cheque electrónico',
  'debin','transferencia inmediata','cvu','cbu','open banking',
  'bnpl','cuotas sin interés','ahora 12',
  'seguro','ahorro','jubilación','anses',
  'agro','campo','exportación','importación','dólar','tipo de cambio',
  'industria','comercio','empresa','negocio'
];

const failedSources = new Set();

function isRelevant(text) {
  const lower = (text || '').toLowerCase();
  return BANKING_KEYWORDS.some(kw => lower.includes(kw));
}

function isRecent(dateStr) {
  if (!dateStr) return true;
  const itemDate = new Date(dateStr);
  if (isNaN(itemDate.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  return itemDate >= cutoff;
}

async function fetchFeed(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || [])
      .filter(item => isRecent(item.pubDate || item.isoDate))
      .filter(item => isRelevant(item.title + ' ' + (item.contentSnippet || item.content || '')))
      .slice(0, 20)
      .map(item => ({
        id: Buffer.from((item.link || item.guid || item.title || Math.random().toString()) + source.name)
              .toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16),
        title: (item.title || 'Sin título').replace(/<[^>]*>/g, '').trim(),
        summary: (item.contentSnippet || item.content || '')
                  .replace(/<[^>]*>/g, '').slice(0, 250).trim(),
        url: item.link || '#',
        date: item.pubDate || item.isoDate || new Date().toISOString(),
        source: source.name,
        category: source.category,
        region: 'Argentina'
      }));

    if (items.length > 0) failedSources.delete(source.name);
    return items;
  } catch (err) {
    failedSources.add(source.name);
    console.warn(`[BINDmark] Feed failed: ${source.name} — ${err.message}`);
    return [];
  }
}

let cache = { items: [], lastUpdated: null, failedSources: [] };

async function refreshNews() {
  console.log('[BINDmark] Refreshing Argentine banking news...');
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchFeed(s)));
  const allItems = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  const seen = new Set();
  const unique = allItems.filter(item => {
    const key = item.url === '#' ? item.title : item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => new Date(b.date) - new Date(a.date));

  cache = {
    items: unique,
    lastUpdated: new Date().toISOString(),
    failedSources: Array.from(failedSources)
  };

  console.log(`[BINDmark] ${unique.length} AR banking items loaded`);
  return cache;
}

function getCache() { return cache; }
function getSources() {
  return RSS_SOURCES.map(s => ({ ...s, region: 'Argentina', status: failedSources.has(s.name) ? 'error' : 'ok' }));
}

module.exports = { refreshNews, getCache, getSources };
