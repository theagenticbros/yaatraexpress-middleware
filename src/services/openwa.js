// ============================================================
// OPENWA SERVICE
// All WhatsApp API calls — send messages, typing, status
// ============================================================
import axios from 'axios';
import { logger } from './logger.js';

const OPENWA_URL = process.env.OPENWA_URL || 'http://localhost:8002';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || 'dev-admin-key';
const SESSION_ID = process.env.OPENWA_SESSION_ID || '93e40c89-8ca7-4a45-95ca-8489790426b9';

const openwaClient = axios.create({
  baseURL: OPENWA_URL,
  headers: {
    'X-API-Key': OPENWA_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

openwaClient.interceptors.request.use(request => {
  logger.info('Starting Request', { url: request.url, headers: request.headers });
  return request;
});

// ── Send Text Message ─────────────────────────────────────────
/**
 * Send a text message to a WhatsApp number.
 * @param {string} to - Phone number (e.g. '919971000635@c.us' or '919971000635')
 * @param {string} message - Text to send
 */
export async function sendMessage(to, message) {
  const chatId = formatChatId(to);

  try {
    const response = await openwaClient.post(`/api/sessions/${SESSION_ID}/messages/send-text`, {
      chatId,
      text: message,
    });

    logger.info(`📤 Message sent to ${to} | msgId: ${response.data?.messageId || response.data?.id}`);
    return response.data;
  } catch (err) {
    logger.error(`❌ Failed to send message to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

// ── Typing Indicator ──────────────────────────────────────────
/**
 * Send/stop typing indicator in a chat.
 * @param {string} chatId - Chat ID
 * @param {boolean} typing - true = start typing, false = stop
 */
export async function sendTypingIndicator(chatId, typing) {
  const formattedChatId = formatChatId(chatId);

  try {
    // Note: The custom repository may not support typing indicators natively yet
    // Catch errors silently so it doesn't break the bot flow
    logger.debug(`Typing indicator skipped (not implemented in custom OpenWA for ${chatId})`);
  } catch (err) {
    // Non-fatal — typing indicator is cosmetic
    logger.warn(`Typing indicator failed for ${chatId}:`, err.message);
  }
}

// ── Mark as Read ──────────────────────────────────────────────
/**
 * Mark a message as read (shows blue ticks — human behaviour).
 * @param {string} messageId - The message ID to mark as read
 */
export async function markAsRead(messageId) {
  try {
    // Note: read receipts not explicitly exposed in basic custom API
    logger.debug(`Mark as read skipped (not implemented for msg ${messageId})`);
  } catch (err) {
    logger.warn('Mark as read failed:', err.message);
  }
}

// ── Get Session QR ────────────────────────────────────────────
/**
 * Fetch WhatsApp QR code for current session.
 * Auto-starts the session if not started.
 */
export async function getSessionQR() {
  try {
    const response = await openwaClient.get(`/api/sessions/${SESSION_ID}/qr`);
    return response.data;
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.message?.includes('not started')) {
      logger.info('Session not started. Attempting to start session...');
      try {
        await openwaClient.post(`/api/sessions/${SESSION_ID}/start`);
        // Wait a few seconds for QR to generate
        await new Promise(resolve => setTimeout(resolve, 5000));
        const retryResponse = await openwaClient.get(`/api/sessions/${SESSION_ID}/qr`);
        return retryResponse.data;
      } catch (startErr) {
        if (startErr.response?.status === 400 && startErr.response?.data?.message?.includes('not ready yet')) {
           return { qrCode: null, status: 'initializing', message: 'Engine is starting up, please wait...' };
        }
        logger.error('Failed to start session and get QR:', startErr.message);
        throw startErr;
      }
    }
    
    if (err.response?.status === 400 && err.response?.data?.message?.includes('not ready yet')) {
       return { qrCode: null, status: 'initializing', message: 'Engine is starting up, please wait...' };
    }
    
    logger.error('Failed to get QR code:', err.message);
    throw err;
  }
}

// ── Get Session Status ────────────────────────────────────────
export async function getSessionStatus() {
  try {
    const response = await openwaClient.get(`/api/sessions/${SESSION_ID}`);
    return response.data;
  } catch (err) {
    return { status: 'disconnected', error: err.message };
  }
}

// ── Ensure Webhook Registered ─────────────────────────────────
/**
 * Automatically register the middleware webhook if it doesn't exist
 */
export async function ensureWebhook() {
  try {
    const response = await openwaClient.get(`/api/sessions/${SESSION_ID}/webhooks`);
    const webhooks = response.data || [];
    
    // Check if our webhook is already registered
    const webhookUrl = process.env.WEBHOOK_URL || 'http://middleware:3001/webhook/inbound';
    const exists = webhooks.some(w => w.url === webhookUrl);
    
    if (!exists) {
      logger.info(`Webhook not found. Registering ${webhookUrl}...`);
      await openwaClient.post(`/api/sessions/${SESSION_ID}/webhooks`, {
        url: webhookUrl,
        events: ['message.received', 'session.status', 'session.authenticated'],
        retryCount: 3
      });
      logger.info('Webhook successfully registered!');
    } else {
      logger.info(`Webhook already registered: ${webhookUrl}`);
    }
  } catch (err) {
    logger.error('Failed to ensure webhook:', err.response?.data || err.message);
  }
}

/**
 * Ensure phone number is in WhatsApp chat ID format.
 * Input: '919971000635' or '+919971000635'
 * Output: '919971000635@c.us'
 */
function formatChatId(phone) {
  // Already formatted
  if (phone.includes('@')) return phone;

  // Remove + and spaces
  const cleaned = phone.replace(/[+\s-]/g, '');
  return `${cleaned}@c.us`;
}
