// src/intelligence.js — Motor de matching clientes × noticias AR con Claude API

const fetch = require('node-fetch');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// ── Matching semántico ligero (sin IA) para pre-filtrar ────────────────────
const SECTOR_KEYWORDS = {
  agropecuario:    ['agro', 'campo', 'soja', 'maíz', 'trigo', 'ganadería', 'cereales', 'feedlot', 'cosecha', 'semilla', 'exportación agro', 'agroexport'],
  tecnología:      ['tech', 'software', 'saas', 'startup', 'digital', 'it ', ' ti ', 'sistemas', 'desarrollo', 'app', 'plataforma', 'ecommerce', 'marketplace'],
  industria:       ['manufactura', 'industrial', 'fábrica', 'producción', 'planta', 'maquinaria', 'metalúrgica', 'automotriz', 'textil', 'química'],
  comercio:        ['retail', 'comercio', 'tienda', 'distribuidor', 'mayorista', 'minorista', 'supermercado', 'shopping', 'local'],
  servicios:       ['consultoría', 'servicios', 'profesional', 'estudio', 'asesoría', 'contador', 'abogado', 'marketing', 'publicidad'],
  construcción:    ['construcción', 'inmobiliaria', 'developer', 'real estate', 'obra', 'arquitectura', 'ingeniería civil'],
  salud:           ['salud', 'clínica', 'farmacia', 'médico', 'hospital', 'prepaga', 'laboratorio', 'odontología'],
  transporte:      ['transporte', 'logística', 'flota', 'camión', 'courier', 'distribución', 'traslado'],
  alimentos:       ['alimentos', 'food', 'gastronómico', 'restaurante', 'catering', 'frigorífico', 'bebidas'],
  finanzas:        ['financiera', 'inversión', 'fondo', 'bróker', 'seguros', 'aseguradora']
};

function detectSectors(text) {
  const lower = (text || '').toLowerCase();
  const matched = [];
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) matched.push(sector);
  }
  return matched.length > 0 ? matched : ['general'];
}

function preMatch(client, news) {
  const clientSectors = detectSectors(client.rubro);
  const newsSectors = detectSectors(news.title + ' ' + news.summary);
  
  // Si algún sector coincide, es candidato
  const overlap = clientSectors.filter(s => newsSectors.includes(s));
  if (overlap.length > 0) return true;
  
  // También matchear si la noticia es de banca/fintech (siempre relevante para comerciales)
  const alwaysRelevant = ['crédito', 'préstamo', 'financiamiento', 'línea', 'subsidio', 'sgr', 'leasing', 'factoring', 'pyme', 'mipyme', 'banco', 'fintech', 'digital'];
  const newsText = (news.title + ' ' + news.summary).toLowerCase();
  return alwaysRelevant.some(kw => newsText.includes(kw));
}

// ── Claude API: genera insight comercial ──────────────────────────────────
async function generateInsight({ client, news, mode = 'pitch' }) {
  const systemPrompt = `Sos un asesor comercial bancario senior especializado en PYMES, MEGRAs y corporaciones argentinas. 
Tu rol es ayudar a la fuerza comercial de un banco a identificar oportunidades de negocio y preparar pitches concisos y accionables.
Respondés siempre en español argentino, de forma directa y sin rodeos. Máximo 3 oraciones por sección.`;

  const userPrompt = mode === 'pitch'
    ? `CLIENTE: ${client.nombre} (CUIT: ${client.cuit}) | Rubro: ${client.rubro} | Segmento: ${client.segmento || 'PYME'}

NOTICIA: "${news.title}"
${news.summary ? `Contexto: ${news.summary}` : ''}
Fuente: ${news.source} | Fecha: ${new Date(news.date).toLocaleDateString('es-AR')}

Generá un insight comercial con este formato JSON exacto (sin markdown, sin backticks):
{
  "relevancia": "ALTA|MEDIA|BAJA",
  "oportunidad": "Una línea: qué producto/servicio bancario aplica",
  "pitch": "2-3 oraciones: cómo el comercial debe presentar esto al cliente, usando la noticia como disparador",
  "accion": "Una acción concreta para el comercial (ej: 'Llamar esta semana para ofrecer línea SGR')"
}`
    : `NOTICIA: "${news.title}"
${news.summary ? `Contexto: ${news.summary}` : ''}
Fuente: ${news.source}

CLIENTES QUE APLICAN:
${client.map((c, i) => `${i+1}. ${c.nombre} | Rubro: ${c.rubro} | Segmento: ${c.segmento || 'PYME'}`).join('\n')}

Para cada cliente, generá un array JSON (sin markdown, sin backticks):
[{"cuit": "...", "relevancia": "ALTA|MEDIA|BAJA", "oportunidad": "...", "pitch": "...", "accion": "..."}]`;

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Limpiar posible markdown
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.warn('[Intelligence] Claude API error:', err.message);
    return mode === 'pitch'
      ? { relevancia: 'MEDIA', oportunidad: 'Evaluar manualmente', pitch: 'Ver noticia adjunta.', accion: 'Contactar al cliente' }
      : (Array.isArray(client) ? client.map(c => ({ cuit: c.cuit, relevancia: 'MEDIA', oportunidad: 'Evaluar', pitch: '', accion: '' })) : []);
  }
}

module.exports = { preMatch, generateInsight, detectSectors };
