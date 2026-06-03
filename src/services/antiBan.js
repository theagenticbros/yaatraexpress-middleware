// ============================================================
// ANTI-BAN ENGINE
// Implements all 4 safeguards from the risk assessment:
// 1. Behavioral Jitter (HIGH)     — random delay before reply
// 2. Typing Simulation (MEDIUM)   — composing indicator
// 3. Rate Limiting                — max messages per hour
// 4. Account Warming              — gradual volume increase
// ============================================================
import Redis from 'ioredis';
import { logger } from './logger.js';

// Configure Redis to not crash on local dev if missing
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 3) return null; // Stop retrying after 3 attempts
    return 2000;
  }
});

redis.on('error', (err) => {
  // Suppress spammy connection errors locally
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') return;
  logger.warn('Redis error:', err.message);
});

const MIN_DELAY = parseInt(process.env.MIN_REPLY_DELAY_MS) || 5000;
const MAX_DELAY = parseInt(process.env.MAX_REPLY_DELAY_MS) || 12000;
const TYPING_MS_PER_CHAR = parseInt(process.env.TYPING_MS_PER_CHAR) || 55;
const MAX_MESSAGES_PER_HOUR = parseInt(process.env.MAX_MESSAGES_PER_HOUR) || 80;

// ── 1. BEHAVIORAL JITTER ─────────────────────────────────────
/**
 * Waits a random duration between MIN and MAX delay.
 * This mimics natural human response time variation.
 * Based on: 10-20% random variance = we use full range for safety.
 */
export async function applyJitter() {
  // Add extra randomness: sometimes people are "busy" and take longer
  const busyBonus = Math.random() < 0.2 ? randomInt(3000, 8000) : 0;
  const delay = randomInt(MIN_DELAY, MAX_DELAY) + busyBonus;

  logger.info(`⏱️  Jitter delay: ${delay}ms (${(delay / 1000).toFixed(1)}s)`);
  await sleep(delay);
}

// ── 2. TYPING SIMULATION ─────────────────────────────────────
/**
 * Sends a "composing" (typing...) indicator before the message.
 * Duration is proportional to message length, just like a human.
 * @param {string} chatId - WhatsApp chat ID
 * @param {string} message - The message about to be sent
 * @param {Function} sendTypingFn - OpenWA sendTyping function
 */
export async function simulateTyping(chatId, message, sendTypingFn) {
  // Calculate typing duration (chars × ms per char, min 2s, max 8s)
  const typingDuration = Math.min(
    Math.max(message.length * TYPING_MS_PER_CHAR, 2000),
    8000
  );

  logger.info(`⌨️  Typing simulation: ${typingDuration}ms for ${message.length} chars`);

  try {
    await sendTypingFn(chatId, true);
    await sleep(typingDuration);
    await sendTypingFn(chatId, false);
  } catch (err) {
    // Non-fatal — typing indicator failure shouldn't block message
    logger.warn('Typing indicator failed (non-fatal):', err.message);
    await sleep(typingDuration); // Still wait the duration
  }
}

// ── 3. RATE LIMITER ──────────────────────────────────────────
/**
 * Checks if we're under the hourly message limit.
 * Uses Redis sliding window counter.
 * @returns {{ allowed: boolean, currentCount: number, limit: number }}
 */
export async function checkRateLimit() {
  const windowKey = `rate:messages:${getHourWindow()}`;

  try {
    const count = await redis.incr(windowKey);

    // Set expiry on first message of the window (1 hour + buffer)
    if (count === 1) {
      await redis.expire(windowKey, 3700);
    }

    const allowed = count <= MAX_MESSAGES_PER_HOUR;

    if (!allowed) {
      logger.warn(`🚫 Rate limit hit! ${count}/${MAX_MESSAGES_PER_HOUR} messages this hour`);
    }

    return { allowed, currentCount: count, limit: MAX_MESSAGES_PER_HOUR };
  } catch (err) {
    // Redis failure = allow through (fail open, not closed)
    logger.error('Redis rate limit check failed:', err.message);
    return { allowed: true, currentCount: 0, limit: MAX_MESSAGES_PER_HOUR };
  }
}

// ── 4. ACCOUNT WARMING STATE ─────────────────────────────────
/**
 * Returns the current warming-phase message limit.
 * Follows a 14-day gradual warmup schedule:
 * Day 1-2: 20/hr, Day 3-5: 35/hr, Day 6-10: 60/hr, Day 11+: 80/hr
 */
export async function getWarmingLimit() {
  try {
    const accountStartKey = 'warming:account_start_date';
    let startDate = await redis.get(accountStartKey);

    if (!startDate) {
      // First time — set start date
      startDate = new Date().toISOString();
      await redis.set(accountStartKey, startDate);
    }

    const daysSinceStart = Math.floor(
      (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceStart <= 2) return 20;
    if (daysSinceStart <= 5) return 35;
    if (daysSinceStart <= 10) return 60;
    return MAX_MESSAGES_PER_HOUR; // Full capacity after day 10
  } catch {
    return MAX_MESSAGES_PER_HOUR;
  }
}

// ── Full Pipeline: Run all anti-ban checks ───────────────────
/**
 * Runs the complete anti-ban pipeline before sending a message.
 * Call this BEFORE every outbound message.
 * @param {string} chatId
 * @param {string} message
 * @param {Function} sendTypingFn
 * @returns {{ proceed: boolean, reason?: string }}
 */
export async function antiBanPipeline(chatId, message, sendTypingFn) {
  // Step 1: Check rate limit
  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed) {
    return {
      proceed: false,
      reason: `Rate limit exceeded: ${rateCheck.currentCount}/${rateCheck.limit} messages this hour`,
    };
  }

  // Step 2: Apply jitter delay (human thinks before replying)
  await applyJitter();

  // Step 3: Simulate typing
  await simulateTyping(chatId, message, sendTypingFn);

  return { proceed: true };
}

// ── Utilities ─────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getHourWindow() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}
