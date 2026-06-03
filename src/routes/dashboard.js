// ============================================================
// DASHBOARD API ROUTES (Meta Cloud API edition)
// Used by the Next.js admin dashboard to fetch data.
// QR code routes removed — Meta API is always connected.
// ============================================================
import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { getSessionStatus } from '../services/whatsapp.js';
import { updateLead } from '../services/supabase.js';
import { logger } from '../services/logger.js';

export const dashboardRouter = Router();

// ── GET /api/leads — All active leads ────────────────────────
dashboardRouter.get('/leads', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('v_active_leads')
      .select('*')
      .limit(100);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Error fetching leads:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/leads/:id/conversation — Full chat history ──────
dashboardRouter.get('/leads/:id/conversation', async (req, res) => {
  try {
    const { data, error } = await supabase
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

// ── POST /api/leads/:id/takeover — Human takes over ──────────
dashboardRouter.post('/leads/:id/takeover', async (req, res) => {
  try {
    await updateLead(req.params.id, { human_active: true });
    logger.info(`🙋 Human takeover for lead: ${req.params.id}`);
    res.json({ success: true, message: 'AI paused. You have control.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/leads/:id/release — Return to AI ───────────────
dashboardRouter.post('/leads/:id/release', async (req, res) => {
  try {
    await updateLead(req.params.id, {
      human_active:       false,
      conversation_state: 'qualifying',
    });
    logger.info(`🤖 AI restored for lead: ${req.params.id}`);
    res.json({ success: true, message: 'AI re-activated for this customer.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/stats — Dashboard stats ─────────────────────────
dashboardRouter.get('/stats', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('v_daily_stats').select('*').single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/whatsapp/status — Meta API connection status ─────
// With Meta Cloud API, there is no QR code or session to manage.
// The number is always connected via Meta's servers.
dashboardRouter.get('/whatsapp/status', async (_req, res) => {
  try {
    const status = await getSessionStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/followups — Leads needing follow-up ─────────────
dashboardRouter.get('/followups', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('v_followup_required').select('*');
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
