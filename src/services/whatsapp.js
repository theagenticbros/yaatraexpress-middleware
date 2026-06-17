// ============================================================
// META WHATSAPP CLOUD API SERVICE
// Replaces openwa.js — no Docker, no local server needed.
// Messages go through Meta's official servers 24/7.
// ============================================================
import axios from 'axios';
import { logger } from './logger.js';

const API_VERSION = 'v20.0';

// Build client dynamically so env vars are always fresh
function getMetaClient() {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_ID     = process.env.META_PHONE_NUMBER_ID;
  return axios.create({
    baseURL: `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}`,
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    timeout: 30000,
  });
}

// ── Send Text Message ─────────────────────────────────────────
/**
 * Send a plain text WhatsApp message via Meta Cloud API.
 * @param {string} to      - Phone number e.g. '919971000635'
 * @param {string} message - Text body to send
 */
export async function sendMessage(to, message) {
  const phone = cleanPhone(to);

  try {
    const response = await getMetaClient().post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                phone,
      type:              'text',
      text: {
        preview_url: false,
        body:        message,
      },
    });

    const msgId = response.data?.messages?.[0]?.id;
    logger.info(`📤 Sent to ${phone} | msgId: ${msgId}`);
    return response.data;
  } catch (err) {
    logger.error(`❌ Failed to send to ${phone}:`, err.response?.data || err.message);
    throw err;
  }
}

// ── Mark as Read (blue ticks) ──────────────────────────────────
/**
 * Mark an incoming message as read.
 * @param {string} messageId - The wamid message ID from Meta webhook
 */
export async function markAsRead(messageId) {
  try {
    await getMetaClient().post('/messages', {
      messaging_product: 'whatsapp',
      status:            'read',
      message_id:        messageId,
    });
    logger.debug(`✅ Marked read: ${messageId}`);
  } catch (err) {
    // Non-fatal — read receipts are cosmetic
    logger.warn('markAsRead failed (non-fatal):', err.message);
  }
}

// ── Typing Indicator (graceful no-op) ─────────────────────────
/**
 * Meta Cloud API does not support typing indicators.
 * This is a no-op so the antiBan pipeline still runs its timer.
 */
export async function sendTypingIndicator(_chatId, _typing) {
  // No-op — Meta doesn't expose composing indicator via Cloud API
}

// ── Connection / Account Status ───────────────────────────────
/**
 * Returns the current status of the connected WhatsApp number.
 * With Meta Cloud API the number is always "connected" — no QR needed.
 */
export async function getSessionStatus() {
  try {
    const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    const resp = await axios.get(
      `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    return {
      status:       'connected',
      provider:     'meta_cloud_api',
      phone:        resp.data?.display_phone_number,
      displayName:  resp.data?.verified_name,
      qualityRating: resp.data?.quality_rating,
    };
  } catch (err) {
    logger.error('getSessionStatus failed:', err.message);
    return { status: 'error', provider: 'meta_cloud_api', error: err.message };
  }
}

// ── Internal: clean phone number ──────────────────────────────
function cleanPhone(phone) {
  // Remove +, spaces, dashes, and any WhatsApp suffixes
  return String(phone)
    .replace('@c.us', '')
    .replace('@s.whatsapp.net', '')
    .replace(/[+\s\-]/g, '');
}
