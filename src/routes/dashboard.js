// ============================================================
// DASHBOARD API ROUTES — YaatraExpress Admin Panel
// ============================================================
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { updateLead } from '../services/supabase.js';
import { sendMessage } from '../services/whatsapp.js';
import { logger } from '../services/logger.js';

export const dashboardRouter = Router();

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Simple password middleware ────────────────────────────────
function requireAuth(req, res, next) {
  const pwd = process.env.DASHBOARD_PASSWORD || 'yaatra2025';
  const provided = req.headers['x-dashboard-key'] || req.query.key;
  if (provided === pwd) return next();
  res.status(401).json({ success: false, error: 'Unauthorized. Provide ?key=YOUR_PASSWORD' });
}

// ── GET /api/leads ────────────────────────────────────────────
dashboardRouter.get('/leads', requireAuth, async (_req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('leads')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/leads/:id/conversation ──────────────────────────
dashboardRouter.get('/leads/:id/conversation', requireAuth, async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('conversations')
      .select('*')
      .eq('lead_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/stats ────────────────────────────────────────────
dashboardRouter.get('/stats', requireAuth, async (_req, res) => {
  try {
    const sb = getSupabase();
    const [leads, convs, handoffs] = await Promise.all([
      sb.from('leads').select('id, booking_status, conversation_state, human_active, created_at'),
      sb.from('conversations').select('id, direction, created_at'),
      sb.from('leads').select('id').eq('conversation_state', 'human_handoff'),
    ]);
    const totalLeads    = leads.data?.length || 0;
    const humanActive   = leads.data?.filter(l => l.human_active).length || 0;
    const bookingIntent = leads.data?.filter(l => l.conversation_state === 'booking_intent').length || 0;
    const handoffCount  = handoffs.data?.length || 0;
    const totalMessages = convs.data?.length || 0;
    const aiMessages    = convs.data?.filter(c => c.direction === 'outbound').length || 0;
    res.json({ success: true, data: { totalLeads, humanActive, bookingIntent, handoffCount, totalMessages, aiMessages } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/leads/:id/takeover — Human takes over ──────────
dashboardRouter.post('/leads/:id/takeover', requireAuth, async (req, res) => {
  try {
    await updateLead(req.params.id, { human_active: true });
    logger.info(`🙋 Human takeover: ${req.params.id}`);
    res.json({ success: true, message: 'AI paused. You have control.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/leads/:id/release — Return to AI ───────────────
dashboardRouter.post('/leads/:id/release', requireAuth, async (req, res) => {
  try {
    await updateLead(req.params.id, { human_active: false, conversation_state: 'qualifying' });
    logger.info(`🤖 AI restored: ${req.params.id}`);
    res.json({ success: true, message: 'AI re-activated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/leads/:id/send — Admin sends message ───────────
dashboardRouter.post('/leads/:id/send', requireAuth, async (req, res) => {
  try {
    const { message, phone } = req.body;
    if (!message || !phone) return res.status(400).json({ success: false, error: 'message and phone required' });
    await sendMessage(phone, message);
    // Save to conversations
    await getSupabase().from('conversations').insert({
      lead_id: req.params.id,
      direction: 'outbound',
      sender: 'human',
      message_content: message,
      message_type: 'text',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
