// ============================================================
// SUPABASE SERVICE
// All database reads and writes for the AI agent
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── LEADS ────────────────────────────────────────────────────

/**
 * Get or create a lead by phone number.
 * Returns the lead record (existing or newly created).
 */
export async function getOrCreateLead(phoneNumber, displayName = null) {
  // Try to find existing lead
  const { data: existing, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    logger.error('Error fetching lead:', fetchError.message);
    throw fetchError;
  }

  if (existing) return existing;

  // Create new lead
  const { data: newLead, error: createError } = await supabase
    .from('leads')
    .insert({
      phone_number: phoneNumber,
      display_name: displayName,
      conversation_state: 'new',
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (createError) {
    logger.error('Error creating lead:', createError.message);
    throw createError;
  }

  logger.info(`✨ New lead created: ${phoneNumber}`);
  return newLead;
}

/**
 * Update lead data with newly extracted information.
 * Only updates fields that are provided (non-null).
 */
export async function updateLead(leadId, updates) {
  const cleanUpdates = {
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  };

  // Only include fields that have actual values
  if (updates.trek_name) cleanUpdates.interested_trek_name = updates.trek_name;
  if (updates.trek_id) cleanUpdates.interested_trek_id = updates.trek_id;
  if (updates.group_size) cleanUpdates.group_size = parseInt(updates.group_size);
  if (updates.preferred_date) cleanUpdates.preferred_date = updates.preferred_date;
  if (updates.pickup_city) cleanUpdates.pickup_city = updates.pickup_city;
  if (updates.customer_name) cleanUpdates.full_name = updates.customer_name;
  if (updates.conversation_state) cleanUpdates.conversation_state = updates.conversation_state;
  if (updates.special_requirements) cleanUpdates.special_requirements = updates.special_requirements;
  if (typeof updates.human_active === 'boolean') cleanUpdates.human_active = updates.human_active;
  if (updates.total_amount_quoted) cleanUpdates.total_amount_quoted = updates.total_amount_quoted;
  if (updates.booking_status) cleanUpdates.booking_status = updates.booking_status;
  if (updates.human_notified_at) cleanUpdates.human_notified_at = updates.human_notified_at;

  const { error } = await supabase
    .from('leads')
    .update(cleanUpdates)
    .eq('id', leadId);

  if (error) logger.error('Error updating lead:', error.message);
}

// ── CONVERSATIONS ─────────────────────────────────────────────

/**
 * Save a message to the conversation log.
 */
export async function saveMessage({
  leadId,
  direction,
  sender,
  content,
  messageType = 'text',
  wasHandoffTrigger = false,
  groqModel = null,
  tokensUsed = null,
  latencyMs = null,
}) {
  const { error } = await supabase.from('conversations').insert({
    lead_id: leadId,
    direction,
    sender,
    message_content: content,
    message_type: messageType,
    was_handoff_trigger: wasHandoffTrigger,
    groq_model_used: groqModel,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
  });

  if (error) logger.error('Error saving message:', error.message);
}

/**
 * Get conversation history for a lead (last N messages).
 */
export async function getConversationHistory(leadId, limit = 20) {
  const { data, error } = await supabase
    .from('conversations')
    .select('direction, sender, message_content, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('Error fetching conversation history:', error.message);
    return [];
  }

  return data || [];
}

// ── TREK KNOWLEDGE ────────────────────────────────────────────

/**
 * Find a trek by partial name match (fuzzy search).
 * The AI might give us "Hampta" and we match "Hampta Pass Trek".
 */
export async function findTrekByName(trekName) {
  if (!trekName) return null;

  const searchTerm = trekName.toLowerCase().trim();

  const { data: allTreks } = await supabase
    .from('treks')
    .select('id, slug, name')
    .eq('is_active', true);

  if (!allTreks) return null;

  // Try exact match first
  const exact = allTreks.find(
    (t) => t.name.toLowerCase() === searchTerm || t.slug === searchTerm
  );
  if (exact) return exact;

  // Try partial match (any word in trek name appears in search term)
  const partial = allTreks.find(
    (t) =>
      t.name.toLowerCase().includes(searchTerm) ||
      searchTerm.includes(t.name.toLowerCase().split(' ')[0].toLowerCase())
  );

  return partial || null;
}

/**
 * Get full trek context (trek + pricing + itinerary + faqs).
 * This is what gets injected into the AI's system prompt.
 */
export async function getTrekContext(trekId) {
  if (!trekId) return null;

  const [trekRes, pricingRes, itineraryRes, faqRes] = await Promise.all([
    supabase.from('treks').select('*').eq('id', trekId).single(),
    supabase.from('trek_pricing').select('*').eq('trek_id', trekId).order('min_group_size'),
    supabase.from('trek_itinerary').select('*').eq('trek_id', trekId).order('day_number'),
    supabase
      .from('faq_knowledge')
      .select('*')
      .or(`trek_id.eq.${trekId},trek_id.is.null`)
      .limit(15),
  ]);

  return {
    trek: trekRes.data,
    pricing: pricingRes.data || [],
    itinerary: itineraryRes.data || [],
    faqs: faqRes.data || [],
  };
}

/**
 * Get all active treks (for when customer hasn't picked one yet).
 */
export async function getAllTreks() {
  const { data } = await supabase
    .from('treks')
    .select('name, location, duration_days, difficulty, best_season_months, base_price_per_person')
    .eq('is_active', true)
    .order('base_price_per_person');

  return data || [];
}

/**
 * Get price for a specific group size.
 */
export async function getPriceForGroupSize(trekId, groupSize) {
  const { data } = await supabase
    .from('trek_pricing')
    .select('price_per_person, notes')
    .eq('trek_id', trekId)
    .lte('min_group_size', groupSize)
    .or(`max_group_size.gte.${groupSize},max_group_size.is.null`)
    .order('min_group_size', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

// ── HANDOFF ───────────────────────────────────────────────────

/**
 * Log a human handoff notification in the database.
 */
export async function logHandoffNotification(leadId, phoneNumber, triggerMessage, notificationSent) {
  const { error } = await supabase.from('handoff_notifications').insert({
    lead_id: leadId,
    phone_number: phoneNumber,
    trigger_message: triggerMessage,
    notification_sent: notificationSent,
  });

  if (error) logger.error('Error logging handoff:', error.message);
}

export { supabase };
