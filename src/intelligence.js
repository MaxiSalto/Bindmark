// src/intelligence.js — Motor de matching clientes × noticias AR con Claude API
// IMPORTANTE: usa node-fetch que ya está en package.json

let fetchFn;
try {
  fetchFn = require('node-fetch');
} catch(e) {
  // Node 18+ tiene fetch nativo
  fetchFn = global.fetch || (() => Promise.reject(new Error('fetch not available')));
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// ── Keywords por sector para pre-filtrado semántico ───────────────────────────
const SECTOR_KEYWORDS = {
  agropecuario:  ['agro','campo','soja','maíz','trigo','ganadería','cereales','feedlot','cosecha','semilla','exportación agro','agroexport','grano','frigorífico','tambo','apicultura','avicultura'],
  tecnología:    ['tech','software','saas','startup','digital','sistemas','desarrollo','app','plataforma','ecommerce','marketplace','programación','it'],
  industria:     ['manufactura','industrial','fábrica','producción','planta','maquinaria','metalúrgica','automotriz','textil','química','petroquímica','siderúrgica'],
  comercio:      ['retail','comercio','tienda','distribuidor','mayorista','minorista','supermercado','shopping','local','negocio','bazar','ferretería'],
  servicios:     ['consultoría','servicios','profesional','estudio','asesoría','contador','abogado','marketing','publicidad','agencia','auditoría'],
  construcción:  ['construcción','inmobiliaria','developer','real estate','obra','arquitectura','ingeniería civil','hormigón','sanitaria','electricidad'],
  salud:         ['salud','clínica','farmacia','médico','hospital','prepaga','laboratorio','odontología','veterinaria','enfermería'],
  transporte:    ['transporte','logística','flota','camión','courier','distribución','traslado','flete','despacho','depósito'],
  alimentos:     ['alimentos','food','gastronómico','restaurante','catering','bebidas','panificación','dulce','conserva','lácteo'],
  finanzas:      ['financiera','inversión','fondo','bróker','seguros','aseguradora','crédito','préstamo'],
  educación:     ['educación','escuela','colegio','universidad','capacitación','instituto','formación'],
  turismo:       ['turismo','hotel','hotelería','agencia de viajes','viaje','hospedaje','alojamiento']
};

// Keywords bancarios que siempre son relevantes para cualquier empresa
const ALWAYS_RELEVANT = [
  'crédito','préstamo','financiamiento','línea','subsidio','sgr','leasing','factoring',
  'pyme','mipyme','banco','fintech','digital','tasa','bcra','plazo fijo','inversión',
  'tarjeta','transferencia','billetera','cuenta','qr','ahora 12','cuotas','garantía'
];

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
  const newsText = ((news.title || '') + ' ' + (news.summary || '')).toLowerCase();
  const newsSectors = detectSectors(newsText);

  // Coincidencia de sector
  if (clientSectors.some(s => newsSectors.includes(s))) return true;

  // La noticia habla de algo bancario universalmente aplicable
  if (ALWAYS_RELEVANT.some(kw => newsText.includes(kw))) return true;

  return false;
}

// ── Claude API call ───────────────────────────────────────────────────────────
async function generateInsight({ client, news, mode = 'pitch' }) {
  const systemPrompt = `Sos un asesor comercial bancario senior especializado en PYMES, MEGRAs y corporaciones argentinas.
Tu rol es ayudar a la fuerza de ventas de un banco a identificar oportunidades concretas y preparar pitches accionables.
Respondés en español rioplatense, directo y sin vueltas. Máximo 3 oraciones por campo.
Siempre respondés con JSON puro, sin markdown, sin backticks, sin texto antes o después.`;

  let userPrompt;

  if (mode === 'pitch') {
    userPrompt = `CLIENTE: ${client.nombre} (CUIT: ${client.cuit}) | Rubro: ${client.rubro} | Segmento: ${client.segmento || 'PYME'}

NOTICIA: "${news.title}"
${news.summary ? `Contexto: ${news.summary}` : ''}
Fuente: ${news.source} | Fecha: ${new Date(news.date).toLocaleDateString('es-AR')}

Generá un insight comercial. Respondé SOLO con este JSON (sin markdown, sin backticks):
{"relevancia":"ALTA|MEDIA|BAJA","oportunidad":"qué producto bancario aplica en una línea","pitch":"cómo el comercial presenta esto al cliente usando la noticia como disparador (2-3 oraciones)","accion":"una acción concreta esta semana"}`;
  } else {
    // batch: array de clientes
    userPrompt = `NOTICIA: "${news.title}"
${news.summary ? `Contexto: ${news.summary}` : ''}

CLIENTES:
${client.map((c, i) => `${i+1}. ${c.nombre} | Rubro: ${c.rubro} | Segmento: ${c.segmento || 'PYME'} | CUIT: ${c.cuit}`).join('\n')}

Para cada cliente, respondé SOLO con un array JSON (sin markdown, sin backticks):
[{"cuit":"...","relevancia":"ALTA|MEDIA|BAJA","oportunidad":"...","pitch":"...","accion":"..."}]`;
  }

  try {
    const res = await fetchFn(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.warn('[Intelligence] Error:', err.message);
    if (mode === 'pitch') {
      return { relevancia: 'MEDIA', oportunidad: 'Evaluar producto bancario aplicable', pitch: 'Esta noticia puede ser relevante para el negocio del cliente. Consultarlo esta semana.', accion: 'Contactar al cliente para evaluar oportunidad' };
    }
    return Array.isArray(client)
      ? client.map(c => ({ cuit: c.cuit, relevancia: 'MEDIA', oportunidad: 'Evaluar', pitch: 'Ver noticia.', accion: 'Contactar' }))
      : [];
  }
}

module.exports = { preMatch, generateInsight, detectSectors };
