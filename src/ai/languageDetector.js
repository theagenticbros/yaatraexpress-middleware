// ============================================================
// LANGUAGE DETECTOR
// Detects if customer is writing in Hindi/Hinglish or English
// Uses character and vocabulary heuristics (no external API)
// ============================================================

// Common Hindi/Hinglish words that strongly indicate Hindi language
const HINDI_MARKERS = [
  'hai', 'hain', 'tha', 'thi', 'hoga', 'hogi', 'kya', 'kab', 'kaise',
  'kaun', 'kitne', 'kitna', 'aap', 'main', 'hum', 'mera', 'meri', 'mujhe',
  'tumhara', 'aapka', 'aapki', 'yeh', 'woh', 'kuch', 'bahut', 'bohot',
  'accha', 'theek', 'bilkul', 'nahi', 'nahin', 'haan', 'bhai', 'yaar',
  'bata', 'batao', 'chahiye', 'chahta', 'chahti', 'milega', 'milegi',
  'jaana', 'jana', 'karo', 'karna', 'karunga', 'duniya', 'log', 'sab',
  'koi', 'sirf', 'ek', 'do', 'teen', 'char', 'paanch', 'zyada', 'kam',
  'thoda', 'jaldi', 'abhi', 'baad', 'pehle', 'aur', 'par', 'mein',
  'se', 'ke', 'ki', 'ka', 'ko', 'ne', 'bhi', 'hi', 'to', 'toh',
  'liye', 'liye', 'wala', 'wali', 'waale', 'rehna', 'rahega', 'sakte',
  'sakta', 'sakti', 'raha', 'rahi', 'ata', 'ati', 'leke', 'lekar',
];

/**
 * Detects the primary language of a text sample.
 * @param {string} text - Combined recent messages
 * @returns {'hindi' | 'english'}
 */
export function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'english';

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);

  // Check for Devanagari script (definitely Hindi)
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';

  // Count Hindi marker words
  let hindiScore = 0;
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (HINDI_MARKERS.includes(cleanWord)) {
      hindiScore++;
    }
  }

  // Calculate ratio
  const hindiRatio = hindiScore / Math.max(words.length, 1);

  // If more than 10% of words are Hindi markers → Hinglish
  if (hindiRatio > 0.10 || hindiScore >= 3) {
    return 'hindi';
  }

  return 'english';
}
