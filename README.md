# BINDmark 🔭

**Radar de innovación bancaria en tiempo real**  
Agrega noticias de productos bancarios y fintech de los últimos 7 días desde 10 fuentes RSS especializadas.

---

## Stack

- **Node.js 20** + Express
- RSS Parser para feeds en tiempo real
- Cron de actualización cada 30 minutos
- Deploy en **Railway** via Dockerfile

---

## Deploy en Railway

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "feat: BINDmark inicial"
git remote add origin https://github.com/TU_USUARIO/bindmark.git
git push -u origin main
```

### 2. Crear proyecto en Railway
1. Ir a [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub repo**
3. Seleccionar el repositorio `bindmark`
4. Railway detecta el `Dockerfile` automáticamente ✅

### 3. Variables de entorno (opcionales)
En Railway → Settings → Variables:
```
PORT=3000
NEWSAPI_KEY=tu_key_si_queres_ampliar_fuentes
```

### 4. Custom domain
Railway genera una URL pública automáticamente (ej: `bindmark.up.railway.app`)

---

## Desarrollo local

```bash
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000
```

---

## Arquitectura

```
bindmark/
├── src/
│   ├── server.js       # Express + API routes + cron
│   └── scraper.js      # RSS aggregator con filtros de recencia
├── public/
│   └── index.html      # Frontend SPA (paleta BIND)
├── Dockerfile
├── package.json
└── .env.example
```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/news` | Lista noticias (params: `q`, `region`, `category`, `limit`) |
| GET | `/api/sources` | Estado de fuentes RSS |
| GET | `/api/stats` | Métricas del feed |
| POST | `/api/refresh` | Forzar actualización manual |

---

## Fuentes monitoreadas

| Fuente | Región | Categoría |
|--------|--------|-----------|
| The Financial Brand | Global | Innovación Bancaria |
| Finextra | Global | Fintech |
| Banking Technology | Global | Tecnología Bancaria |
| Tearsheet | Global | Fintech |
| American Banker | USA | Banca |
| Finovate | Global | Innovación |
| PaymentsSource | Global | Pagos |
| PYMNTS | Global | Pagos & Fintech |
| iProUP Fintech | Argentina | Fintech |
| Infobae Economía | Argentina | Banca |

---

> Solo noticias de los últimos **7 días** · Actualización automática cada **30 minutos**
