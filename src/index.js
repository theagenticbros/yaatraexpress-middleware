// ============================================================
// YAATRAEXPRESS AI MIDDLEWARE — Entry Point
// Runs as Express on Vercel (serverless) or locally via node.
// ============================================================
import './env.js';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { webhookRouter } from './routes/webhook.js';
import { dashboardRouter } from './routes/dashboard.js';
import { logger } from './services/logger.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin:      process.env.DASHBOARD_URL
                 ? [process.env.DASHBOARD_URL, 'http://localhost:3000']
                 : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Routes ───────────────────────────────────────────────────
// Meta sends GET (verification) + POST (messages) to /webhook
app.use('/webhook', webhookRouter);
app.use('/api', dashboardRouter);

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'yaatra-ai-middleware',
    provider:  'meta_cloud_api',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
  });
});

// ── 404 Fallback ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global Error Handler ──────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Local dev: start server ───────────────────────────────────
// On Vercel, the default export is used instead.
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    logger.info(`🚀 YaatraExpress Middleware on port ${PORT}`);
    logger.info(`🤖 AI Model: ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'}`);
    logger.info(`📱 Meta Phone ID: ${process.env.META_PHONE_NUMBER_ID}`);
  });
}

// Vercel uses this export to handle all requests
export default app;
