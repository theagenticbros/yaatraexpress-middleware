// ============================================================
// GROQ AI AGENT — Core LLM Integration
// Manages: Groq calls, response parsing, data extraction
// ============================================================
import Groq from 'groq-sdk';
import { buildSystemPrompt } from './systemPrompt.js';
import { detectLanguage } from './languageDetector.js';
import { logger } from '../services/logger.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Main AI agent call — returns Shrish's reply + extracted data
 * @param {string} customerMessage - The incoming WhatsApp message
 * @param {Array} conversationHistory - Last N messages from Supabase
 * @param {Object} trekContext - Trek data from Supabase
 * @param {Object} lead - Current lead data
 * @returns {{ reply: string, extractedData: Object, triggerHandoff: boolean }}
 */
export async function runAgent(customerMessage, conversationHistory, trekContext, lead) {
  const startTime = Date.now();

  // Detect language from this message + recent history
  const recentMessages = conversationHistory
    .slice(-5)
    .map((m) => m.message_content)
    .join(' ');
  const detectedLanguage = detectLanguage(customerMessage + ' ' + recentMessages);

  // Build the system prompt (Shrish's full context)
  const systemPrompt = buildSystemPrompt(trekContext, lead, detectedLanguage);

  // Build conversation history for Groq (last 15 messages for context)
  const historyMessages = conversationHistory
    .slice(-15)
    .map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      content: msg.message_content,
    }));

  // Add the current message
  const messages = [
    ...historyMessages,
    { role: 'user', content: customerMessage },
  ];

  logger.info(`🤖 Calling Groq | Model: ${MODEL} | Language: ${detectedLanguage} | History: ${historyMessages.length} msgs`);

  let rawResponse;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.75,        // Slightly creative but consistent
      max_tokens: 600,          // Keep responses concise
      top_p: 0.9,
    });

    rawResponse = completion.choices[0]?.message?.content || '';
    const latencyMs = Date.now() - startTime;
    const tokensUsed = completion.usage?.total_tokens || 0;

    logger.info(`✅ Groq response | ${latencyMs}ms | ${tokensUsed} tokens`);

    // Parse the response — separate WhatsApp message from extracted data
    const parsed = parseAgentResponse(rawResponse);

    return {
      reply: parsed.reply,
      extractedData: parsed.extractedData,
      triggerHandoff: parsed.triggerHandoff,
      tokensUsed,
      latencyMs,
      detectedLanguage,
    };
  } catch (error) {
    logger.error('Groq API error:', error.message);

    // Graceful fallback — Shrish says he'll get back shortly
    const fallback = detectedLanguage === 'hindi'
      ? 'Ek second! Main check karta hoon aur abhi batata hoon 🙏'
      : "One moment! Let me check on that and get back to you shortly 🙏";

    return {
      reply: fallback,
      extractedData: {},
      triggerHandoff: false,
      tokensUsed: 0,
      latencyMs: Date.now() - startTime,
      detectedLanguage,
    };
  }
}

// ── Response Parser ───────────────────────────────────────────
/**
 * Splits raw Groq output into:
 * 1. The actual WhatsApp reply (shown to customer)
 * 2. Extracted structured data (used to update Supabase)
 * 3. Handoff trigger flag
 */
function parseAgentResponse(rawResponse) {
  let reply = rawResponse;
  let extractedData = {};
  let triggerHandoff = false;

  // Check for handoff trigger marker
  if (rawResponse.includes('[TRIGGER_HANDOFF]')) {
    triggerHandoff = true;
    reply = reply.replace('[TRIGGER_HANDOFF]', '').trim();
  }

  // Extract structured JSON data block
  const dataMatch = rawResponse.match(/\[EXTRACTED_DATA\]([\s\S]*?)\[\/EXTRACTED_DATA\]/);
  if (dataMatch) {
    try {
      extractedData = JSON.parse(dataMatch[1].trim());
      // Remove the data block from the reply
      reply = reply.replace(/\[EXTRACTED_DATA\][\s\S]*?\[\/EXTRACTED_DATA\]/g, '').trim();
    } catch (e) {
      logger.warn('Failed to parse extracted data JSON:', e.message);
    }
  }

  // Check handoff in extracted data too
  if (extractedData?.trigger_handoff === true) {
    triggerHandoff = true;
  }

  // Clean up any remaining markers or extra whitespace
  reply = reply
    .replace(/\[TRIGGER_HANDOFF\]/g, '')
    .replace(/\[EXTRACTED_DATA\]/g, '')
    .replace(/\[\/EXTRACTED_DATA\]/g, '')
    .trim();

  return { reply, extractedData, triggerHandoff };
}
