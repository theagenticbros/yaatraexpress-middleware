// ============================================================
// WEBHOOK ROUTE — Meta Cloud API | Clean Production Version
//
// Meta sends two types of requests:
//   GET  /webhook  — one-time verification handshake
//   POST /webhook  — every incoming message & status update
//
// Message flow:
//   Meta → POST /webhook
//   → Parse Meta payload
//   → Load/create lead (Supabase)
//   → Load conversation history + trek context
//   → Run Groq AI (Shrish)
//   → Send reply via Meta Cloud API
//   → Save everything to Supabase
//   → If handoff → notify human on WhatsApp
//
// NOTE: Anti-ban system removed — not needed with the official
// Meta Cloud API. Delays & Redis rate limiting were only
// required to avoid detection on unofficial (OpenWA) libraries.
// ============================================================
import { Router } from 'express';
import { runAgent } from '../ai/agent.js';
import {
  getOrCreateLead,
  updateLead,
  saveMessage,
  getConversationHistory,
  findTrekByName,
  getTrekContext,
  getAllTreks,
  getPriceForGroupSize,
  logHandoffNotification,
} from '../services/supabase.js';
import {
  sendMessage,
  markAsRead,
} from '../services/whatsapp.js';
import { logger } from '../services/logger.js';

export const webhookRouter = Router();

// Phone numbers we NEVER auto-reply to (our own internal numbers)
const IGNORED_PHONES = new Set([
  process.env.HUMAN_PHONE,
  process.env.HUMAN_PHONE?.replace(/\D/g, ''),
].filter(Boolean));

// ── GET /webhook — Meta verification handshake ────────────────
// Meta calls this ONCE when you register the webhook URL.
// We must echo back hub.challenge if the verify_token matches.
webhookRouter.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info('✅ Meta webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('❌ Webhook verification failed — token mismatch');
  return res.status(403).send('Forbidden');
});

// ── POST /webhook — All incoming Meta events ──────────────────
webhookRouter.post('/', async (req, res) => {
  try {
    const body = req.body;

    // Guard: only process WhatsApp Business Account events
    if (body?.object !== 'whatsapp_business_account') {
      return res.status(200).send('EVENT_RECEIVED');
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Delivery/read status updates — log and skip
        if (value?.statuses?.length) {
          for (const s of value.statuses) {
            logger.debug(`📬 Status | msgId: ${s.id} | ${s.status}`);
          }
          continue;
        }

        // Incoming messages
        if (!value?.messages?.length) continue;

        const contacts = value.contacts || [];
        for (const message of value.messages) {
          await handleIncomingMessage(message, contacts);
        }
      }
    }
  } catch (err) {
    logger.error('❌ Webhook top-level error:', err.message);
  }

  // Respond AFTER processing so Vercel keeps the function alive
  return res.status(200).send('EVENT_RECEIVED');
});

// ── Core Message Handler ──────────────────────────────────────
async function handleIncomingMessage(message, contacts) {
  try {
    // Only handle text messages
    if (message.type !== 'text') {
      logger.debug(`⏭️  Skipping message type: ${message.type}`);
      return;
    }

    const senderPhone = message.from;           // e.g. "917278802692"
    const messageText = message.text?.body?.trim();
    const messageId   = message.id;             // wamid.xxx

    if (!senderPhone || !messageText) return;

    // Resolve display name from contacts array
    const contact     = contacts.find(c => c.wa_id === senderPhone);
    const displayName = contact?.profile?.name || null;

    // Skip internal/admin phone numbers
    if (IGNORED_PHONES.has(senderPhone)) {
      logger.info(`📵 Ignoring internal phone: ${senderPhone}`);
      return;
    }

    logger.info(`📨 From: ${senderPhone} (${displayName || 'unknown'}) | "${messageText.slice(0, 80)}"`);

    // ── STEP 1: Load or create lead ──────────────────────────
    const lead = await getOrCreateLead(senderPhone, displayName);

    // ── STEP 2: Human takeover — AI suppressed ───────────────
    if (lead.human_active) {
      logger.info(`🙋 Human active for ${senderPhone} — saving message, AI skipped`);
      await saveMessage({
        leadId:    lead.id,
        direction: 'inbound',
        sender:    'customer',
        content:   messageText,
      });
      return;
    }

    // ── STEP 3: Mark as read (blue ticks) ────────────────────
    await markAsRead(messageId);

    // ── STEP 4: Save inbound message ─────────────────────────
    await saveMessage({
      leadId:    lead.id,
      direction: 'inbound',
      sender:    'customer',
      content:   messageText,
    });

    // ── STEP 5: Load conversation history ────────────────────
    const history = await getConversationHistory(lead.id, 20);

    // ── STEP 6: Load trek context ─────────────────────────────
    let trekContext = null;

    if (lead.interested_trek_id) {
      trekContext = await getTrekContext(lead.interested_trek_id);
    } else {
      const allTreks     = await getAllTreks();
      const detectedTrek = await detectTrekFromMessage(messageText, allTreks);

      if (detectedTrek) {
        trekContext = await getTrekContext(detectedTrek.id);
        await updateLead(lead.id, {
          trek_name:          detectedTrek.name,
          trek_id:            detectedTrek.id,
          conversation_state: 'trek_identified',
        });
        lead.interested_trek_id   = detectedTrek.id;
        lead.interested_trek_name = detectedTrek.name;
        lead.conversation_state   = 'trek_identified';
      }

      if (!trekContext) trekContext = { allTreks };
    }

    // ── STEP 7: Run Groq AI (Shrish) ─────────────────────────
    const agentResult = await runAgent(messageText, history, trekContext, lead);
    const { reply, extractedData, triggerHandoff, tokensUsed, latencyMs } = agentResult;

    logger.info(`🤖 Reply: "${reply.slice(0, 80)}" | ${latencyMs}ms | ${tokensUsed} tokens`);

    // ── STEP 8: Update lead with extracted data ───────────────
    const leadUpdates = { ...extractedData };

    if (extractedData.trek_name && !lead.interested_trek_id) {
      const foundTrek = await findTrekByName(extractedData.trek_name);
      if (foundTrek) {
        leadUpdates.trek_id = foundTrek.id;
        if (!trekContext?.trek) trekContext = await getTrekContext(foundTrek.id);
      }
    }

    if (lead.interested_trek_id && (extractedData.group_size || lead.group_size)) {
      const groupSize = extractedData.group_size || lead.group_size;
      const pricing   = await getPriceForGroupSize(lead.interested_trek_id, groupSize);
      if (pricing) {
        leadUpdates.total_amount_quoted = pricing.price_per_person * groupSize;
        if (!leadUpdates.conversation_state) leadUpdates.conversation_state = 'quoted';
      }
    }

    if (triggerHandoff) {
      leadUpdates.conversation_state = 'human_handoff';
      leadUpdates.human_active       = true;
    }

    if (Object.keys(leadUpdates).length > 0) {
      await updateLead(lead.id, leadUpdates);
    }

    // ── STEP 9: Send reply via Meta Cloud API ─────────────────
    await sendMessage(senderPhone, reply);
    logger.info(`📤 Replied to ${senderPhone}`);

    // ── STEP 10: Save outbound message ───────────────────────
    await saveMessage({
      leadId:            lead.id,
      direction:         'outbound',
      sender:            'ai',
      content:           reply,
      wasHandoffTrigger: triggerHandoff,
      groqModel:         process.env.GROQ_MODEL,
      tokensUsed,
      latencyMs,
    });

    // ── STEP 11: Human handoff notification ──────────────────
    if (triggerHandoff) {
      await triggerHumanHandoff(lead, senderPhone, messageText);
    }

    logger.info(`✅ Done for ${senderPhone}`);
  } catch (err) {
    logger.error('❌ Message handler error:', err.message);
  }
}

// ── Human Handoff Notification ────────────────────────────────
async function triggerHumanHandoff(lead, customerPhone, triggerMessage) {
  const HUMAN_PHONE = process.env.HUMAN_PHONE || '917278802692';

  const notification =
`🚨 *New Customer Request — Action Needed*

👤 *Customer:* ${lead.full_name || lead.display_name || 'Unknown'}
📱 *Phone:* +${customerPhone}
🏔️ *Trek Interest:* ${lead.interested_trek_name || 'Not specified'}
👥 *Group Size:* ${lead.group_size || 'Not specified'}
📅 *Travel Date:* ${lead.preferred_date || 'Not specified'}
📍 *Pickup:* ${lead.pickup_city || 'Not specified'}

💬 *Their message:*
"${triggerMessage}"

➡️ Please reply to this customer on WhatsApp directly.
_(Shrish AI is now paused for this customer)_`;

  try {
    await sendMessage(HUMAN_PHONE, notification);
    logger.info(`🔔 Handoff notification sent to ${HUMAN_PHONE}`);
    await logHandoffNotification(lead.id, customerPhone, triggerMessage, true);
    await updateLead(lead.id, { human_notified_at: new Date().toISOString() });
  } catch (err) {
    logger.error('Handoff notification failed:', err.message);
    await logHandoffNotification(lead.id, customerPhone, triggerMessage, false);
  }
}

// ── Trek Detection ─────────────────────────────────────────────
async function detectTrekFromMessage(message, allTreks) {
  if (!allTreks?.length) return null;
  const lowerMsg = message.toLowerCase();

  const trekKeywords = {
    'hampta':         'hampta-pass-trek',
    'hamta':          'hampta-pass-trek',
    'chandratal':     'hampta-pass-trek',
    'kedarkantha':    'kedarkantha-trek',
    'kedar kantha':   'kedarkantha-trek',
    'brahmatal':      'brahmatal-trek',
    'brahma tal':     'brahmatal-trek',
    'dayara':         'dayara-bugyal-trek',
    'bugyal':         'dayara-bugyal-trek',
    'har ki dun':     'har-ki-dun-trek',
    'harkidun':       'har-ki-dun-trek',
    'valley of gods': 'har-ki-dun-trek',
    'chopta':         'chopta-tungnath-trek',
    'tungnath':       'chopta-tungnath-trek',
    'chandrashila':   'chopta-tungnath-trek',
  };

  for (const [keyword, slug] of Object.entries(trekKeywords)) {
    if (lowerMsg.includes(keyword)) {
      return await findTrekByName(slug);
    }
  }
  return null;
}
