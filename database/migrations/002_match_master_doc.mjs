// ============================================================
// MIGRATION 002 — Reconcile Supabase catalog with MASTER_PROMPTS
// ------------------------------------------------------------
// Source of truth: MASTER_PROMPTS/YAATRA-WHATSAPP-SYSTEM-PROMPT.md
//
// Why .mjs and not .sql:
//   The live project is reachable only via the PostgREST service
//   key (no direct Postgres password is available in .env), so
//   schema/catalog changes are applied through @supabase/supabase-js.
//   This file is the canonical, re-runnable record of migration 002.
//   It is IDEMPOTENT — safe to run multiple times.
//
// What it does:
//   1. Deactivates the 4 treks not in the master doc (kept, hidden).
//   2. Updates Hampta Pass + Chopta (→ "Chopta Chandrashila Trek").
//   3. Creates Bhrigu Lake Trek.
//   4. Rewrites pricing as negotiation FLOORS (₹4,800 / ₹4,500) with
//      the ₹5,500 anchor + fixed double-sharing rule in notes.
//   5. Rewrites itineraries to match the doc.
//   6. Makes cancellation/booking FAQs trek-specific per the doc.
//
// Customer data (leads, conversations) is never touched.
//
// Run from the middleware/ folder:  node database/migrations/002_match_master_doc.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Two levels up from middleware/database/migrations/ is the middleware/ root.
const ROOT = path.resolve(__dirname, '..', '..');

// Load .env from the middleware root without depending on `dotenv`.
for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    // Strip surrounding single/double quotes if present (both .env styles).
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Resolve @supabase/supabase-js from this package (where it's installed).
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = await import(pathToFileURL(require.resolve('@supabase/supabase-js')).href);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const log = (...a) => console.log('  ', ...a);
function must(error, what) {
  if (error) {
    console.error(`❌ ${what}:`, error.message);
    process.exit(1);
  }
}

// ── Shared note fragments for the anchor-and-negotiate model ──
const ANCHOR_LINE =
  'ALWAYS quote the offer/anchor price of ₹5,500 first. This is the negotiation FLOOR — never go below it. Double/private sharing room is ₹5,500 and is FIXED (never negotiate it down).';

async function getTrekIdBySlug(slug) {
  const { data, error } = await supabase.from('treks').select('id').eq('slug', slug).maybeSingle();
  must(error, `lookup ${slug}`);
  return data?.id || null;
}

async function replaceChildren(trekId) {
  // Wipe catalog children for a trek so we can re-seed cleanly (idempotent).
  must((await supabase.from('trek_pricing').delete().eq('trek_id', trekId)).error, 'clear pricing');
  must((await supabase.from('trek_itinerary').delete().eq('trek_id', trekId)).error, 'clear itinerary');
  must((await supabase.from('faq_knowledge').delete().eq('trek_id', trekId)).error, 'clear trek faqs');
}

async function insertPricing(trekId, rows) {
  must((await supabase.from('trek_pricing').insert(rows.map(r => ({ trek_id: trekId, ...r })))).error, 'insert pricing');
}
async function insertItinerary(trekId, rows) {
  must((await supabase.from('trek_itinerary').insert(rows.map(r => ({ trek_id: trekId, ...r })))).error, 'insert itinerary');
}
async function insertFaqs(trekId, rows) {
  must((await supabase.from('faq_knowledge').insert(rows.map(r => ({ trek_id: trekId, ...r })))).error, 'insert faqs');
}

async function run() {
  console.log('\n🔧 Migration 002 — matching Supabase to the master doc\n');

  // ════════════════════════════════════════════════════════════
  // 1. DEACTIVATE treks not in the master doc (reversible)
  // ════════════════════════════════════════════════════════════
  const HIDE = ['kedarkantha-trek', 'brahmatal-trek', 'dayara-bugyal-trek', 'har-ki-dun-trek'];
  must((await supabase.from('treks').update({ is_active: false }).in('slug', HIDE)).error, 'deactivate extra treks');
  log(`Deactivated ${HIDE.length} treks (kept in DB, hidden from the bot): ${HIDE.join(', ')}`);

  // ════════════════════════════════════════════════════════════
  // 2. CHOPTA CHANDRASHILA  (update existing chopta-tungnath-trek)
  //    Slug kept so trek-detection keywords keep working.
  // ════════════════════════════════════════════════════════════
  const choptaId = await getTrekIdBySlug('chopta-tungnath-trek');
  must((await supabase.from('treks').update({
    name: 'Chopta Chandrashila Trek',
    location: 'Chopta, Uttarakhand',
    duration_days: 3,
    duration_nights: 2,
    max_altitude_ft: 13549,
    difficulty: 'Easy',
    best_season_months: ['April', 'May', 'October', 'November'],
    has_daily_departure: true,
    pickup_points: [
      'Delhi — Akshardham Metro Station Parking (departure 9:30–10:30 PM)',
      'Rishikesh — Tapovan / Lakshman Jhula (pickup 6:00 AM)',
    ],
    base_price_per_person: 4500,
    short_description:
      'A beginner-friendly Himalayan weekend — Tungnath, the world’s highest Shiva temple, a sunrise summit at Chandrashila, and the mirror-still Deoria Tal.',
    full_description:
      'A 2N/3D beginner-friendly trek in Chopta, Uttarakhand. Visit Tungnath — the world’s highest Shiva temple (3,680 m) — climb to Chandrashila summit (13,549 ft) for 360° views of Nanda Devi, Trishul, Kedar Dome and Chaukhamba, and hike to the crystal-clear Deoria Tal which mirrors Chaukhamba peak. Stay at Sari Village with a bonfire evening.',
    highlights: [
      'Tungnath — the world’s highest Shiva temple (3,680 m), a deeply spiritual stop',
      'Chandrashila summit (13,549 ft) — 360° sunrise views of Nanda Devi, Trishul, Kedar Dome & Chaukhamba',
      'Deoria Tal — a crystal-clear lake that mirrors Chaukhamba peak, perfect for photos & stargazing',
      'Sari Village stay with bonfire and group activities',
      'Beginner-friendly — only 5.5 km of trekking, ideal for a first Himalayan experience',
    ],
    inclusions: [
      'Pickup & drop (Delhi or Rishikesh)',
      'Shared stay in homestay/campsite',
      'Meals: Dinner (Day 1), Breakfast + Dinner (Day 2), Breakfast (Day 3)',
      'Guided trek to Tungnath, Chandrashila & Deoria Tal',
      'Certified (mountaineering) Trek Leader',
      'Trek crew: guides, chefs, assistants, porters/mules',
      'Safety gear: first aid, medical kit, oxygen cylinder, stretcher',
      'Bonfire + group activities',
      'Trek Certificate of Completion',
    ],
    exclusions: [
      'Mule offloading: ₹400/day (up to 10kg bag)',
      'Trek insurance: ₹320/person',
      'GST @5%',
      'Meals en route to/from Rishikesh (self-paid)',
      'Personal expenses (snacks, laundry, etc.)',
    ],
    is_active: true,
    is_recommended: true,
  }).eq('id', choptaId)).error, 'update Chopta');
  await replaceChildren(choptaId);
  await insertPricing(choptaId, [
    { min_group_size: 1, max_group_size: 5, price_per_person: 4800,
      notes: `${ANCHOR_LINE} ₹4,800 is the best/last price for groups under 6.` },
    { min_group_size: 6, max_group_size: null, price_per_person: 4500,
      notes: `${ANCHOR_LINE} ₹4,500 is the best/last price for groups of 6 or more — proactively offer this when they're close to 6.` },
  ]);
  await insertItinerary(choptaId, [
    { day_number: 1, title: 'Departure → Devprayag → Sari Village',
      description: 'Overnight departure from Delhi the night before (9:30–10:30 PM, Akshardham Metro Station Parking). Arrive Rishikesh, then drive via Devprayag Sangam and Dhari Devi Temple to Sari Village for an overnight stay.',
      altitude_ft: 6500, distance_km: 0, duration_hrs: 0, meals: ['Dinner'], accommodation: 'Homestay/campsite at Sari Village' },
    { day_number: 2, title: 'Tungnath & Chandrashila Summit',
      description: 'Trek to Tungnath (world’s highest Shiva temple) and on to Chandrashila summit (13,549 ft) for 360° Himalayan views. Return to Sari Village for a bonfire evening.',
      altitude_ft: 13549, distance_km: 5.5, duration_hrs: 6, meals: ['Breakfast', 'Dinner'], accommodation: 'Homestay/campsite at Sari Village' },
    { day_number: 3, title: 'Deoria Tal & Return to Delhi',
      description: 'Trek to Deoria Tal — a crystal-clear lake reflecting Chaukhamba peak. Optional visit to Omkareshwar Temple. Depart for Delhi around 12–1 PM with an overnight journey back.',
      altitude_ft: 7900, distance_km: 6, duration_hrs: 4, meals: ['Breakfast'], accommodation: 'Overnight travel' },
  ]);
  await insertFaqs(choptaId, [
    { category: 'cancellation',
      question: 'What is the cancellation policy for the Chopta Chandrashila trek?',
      answer: '30+ days before departure: 70% refund. 21–30 days: 50% refund. 11–20 days: 30% refund. 10 days or less: no refund. For cancellations, email helloyaatraexpress@gmail.com.',
      trigger_keywords: ['cancel', 'refund', 'cancellation', 'money back', 'policy'] },
  ]);
  log('Updated Chopta → "Chopta Chandrashila Trek" (pricing, itinerary, cancellation FAQ)');

  // ════════════════════════════════════════════════════════════
  // 3. HAMPTA PASS  (update existing)
  // ════════════════════════════════════════════════════════════
  const hamptaId = await getTrekIdBySlug('hampta-pass-trek');
  must((await supabase.from('treks').update({
    name: 'Hampta Pass Trek',
    location: 'Manali, Himachal Pradesh',
    duration_days: 5,
    duration_nights: 4,
    max_altitude_ft: 14100,
    difficulty: 'Moderate',
    best_season_months: ['June', 'July', 'August', 'September'],
    has_daily_departure: true,
    pickup_points: ['Manali Bus Stand'],
    base_price_per_person: 4500,
    short_description:
      'One pass, two worlds — cross from the lush green Kullu valley into the barren moonscape of Lahaul in a single dramatic day, capped by the stunning Chandratal Lake.',
    full_description:
      'A 5D/4N moderate crossover trek from Manali. Cross Hampta Pass at 14,100 ft with views of Indrasan and Deo Tibba, watch the landscape flip from green Kullu to barren Lahaul-Spiti in one day, cross rivers and snow fields, camp at Balu Ka Ghera, and visit the breathtaking Chandratal Lake on Day 4.',
    highlights: [
      'One of India’s most dramatic landscape transitions — lush Kullu on one side, barren Lahaul-Spiti on the other',
      'Chandratal Lake visit on Day 4 — a stunning high-altitude lake',
      'Glacial terrain, river crossings, snow fields and meadows — this trek has everything',
      'Camp at Balu Ka Ghera with views of Indrasan and Deo Tibba peaks',
      'Cross Hampta Pass at 14,100 ft',
    ],
    inclusions: [
      'All meals from Lunch on Day 1 to Breakfast on Day 5',
      'Accommodation in tents or homestay',
      'Trek guide, cook, helpers, and mules for common luggage',
      'Safety equipment & hiking equipment',
      'Group transfers (Tempo Traveller/Bolero)',
      'Forest camping charges',
      'All applicable taxes',
    ],
    exclusions: [
      'Meals during road journeys',
      'Any kind of insurance',
      'Personal expenses',
      'Carrying personal luggage (mules available at extra cost)',
      'Private individual transfers',
    ],
    is_active: true,
    is_recommended: true,
  }).eq('id', hamptaId)).error, 'update Hampta');
  await replaceChildren(hamptaId);
  await insertPricing(hamptaId, [
    { min_group_size: 1, max_group_size: 3, price_per_person: 4800,
      notes: `${ANCHOR_LINE} ₹4,800 is the best/last price. Booking: ₹1,000 per person reserves the seat; balance due 2 days before the trek.` },
    { min_group_size: 4, max_group_size: null, price_per_person: 4500,
      notes: `${ANCHOR_LINE} ₹4,500 is the best/last price for groups of 4 or more — proactively offer when they're close to 4. Booking: ₹1,000 per person reserves the seat; balance 2 days before.` },
  ]);
  await insertItinerary(hamptaId, [
    { day_number: 1, title: 'Manali → Jobra → Chika',
      description: 'Pickup from Manali Bus Stand, drive to Jobra, then trek to Chika (2 km). Camp at ~10,100 ft along the Rani Nallah river.',
      altitude_ft: 10100, distance_km: 2, duration_hrs: 2, meals: ['Dinner'], accommodation: 'Camp at Chika (Rani Nallah)' },
    { day_number: 2, title: 'Chika → Balu Ka Ghera',
      description: '8 km, 5–6 hrs over rocky banks, meadows and river crossings to the glacier campsite at Balu Ka Ghera.',
      altitude_ft: 11900, distance_km: 8, duration_hrs: 6, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Balu Ka Ghera' },
    { day_number: 3, title: 'Balu Ka Ghera → Hampta Pass → Shea Goru',
      description: 'The big day — cross Hampta Pass (14,100 ft) and descend to Shea Goru. 14 km, 8–9 hrs. Breathtaking.',
      altitude_ft: 14100, distance_km: 14, duration_hrs: 9, meals: ['Breakfast', 'Packed Lunch', 'Dinner'], accommodation: 'Camp at Shea Goru' },
    { day_number: 4, title: 'Shea Goru → Chatru → Chandratal',
      description: 'Trek down to Chatru (8 km), then drive to the stunning Chandratal Lake and return to the Chatru camp.',
      altitude_ft: 12100, distance_km: 8, duration_hrs: 5, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Chatru' },
    { day_number: 5, title: 'Chatru → Manali',
      description: 'Drive back to Manali (85 km via the Atal Tunnel). Trek ends.',
      altitude_ft: 6700, distance_km: 0, duration_hrs: 0, meals: ['Breakfast'], accommodation: 'Drop at Manali Bus Stand' },
  ]);
  await insertFaqs(hamptaId, [
    { category: 'booking',
      question: 'How do I book the Hampta Pass trek?',
      answer: 'A ₹1,000 per person advance reserves your seat. The remaining amount is due 2 days before the trek starts.',
      trigger_keywords: ['book', 'booking', 'advance', 'reserve', 'payment', 'confirm'] },
    { category: 'trek_specific',
      question: 'Is Chandratal Lake included in the Hampta Pass trek?',
      answer: 'Yes! The Chandratal Lake visit is included on Day 4 — one of India’s most beautiful high-altitude lakes, at no extra charge.',
      trigger_keywords: ['chandratal', 'chandra tal', 'lake', 'included'] },
  ]);
  log('Updated Hampta Pass (pricing, itinerary, booking & Chandratal FAQs)');

  // ════════════════════════════════════════════════════════════
  // 4. BHRIGU LAKE  (create new, or update if it already exists)
  // ════════════════════════════════════════════════════════════
  let bhriguId = await getTrekIdBySlug('bhrigu-lake-trek');
  const bhriguRow = {
    slug: 'bhrigu-lake-trek',
    name: 'Bhrigu Lake Trek',
    location: 'Manali, Himachal Pradesh',
    duration_days: 3,
    duration_nights: 2,
    max_altitude_ft: 14100,
    difficulty: 'Moderate',
    best_season_months: ['May', 'June', 'September', 'October'],
    has_daily_departure: true,
    pickup_points: ['Manali Bus Stand'],
    base_price_per_person: 4500,
    short_description:
      'One of Himachal’s most rewarding short treks — vast open meadows and a sacred high-altitude alpine lake with the Pir Panjal range all around.',
    full_description:
      'A 3D/2N easy-to-moderate trek from Manali to Bhrigu Lake (4,300 m / 14,100 ft). A massive payoff for the effort — sweeping alpine meadows, a sacred lake of almost mythical stillness, and Pir Panjal panoramas. Perfect for first-timers who want a real Himalayan experience without going too extreme.',
    highlights: [
      'One of Himachal’s most rewarding short treks — huge payoff for the effort',
      'Vast open meadows, a high-altitude alpine lake, and Pir Panjal range panorama',
      'A sacred lake with almost mythical stillness',
      'Perfect first real Himalayan experience without going too extreme',
    ],
    inclusions: [
      'Pickup from Manali Bus Stand',
      'Transportation (Manali → Gulaba → Manali)',
      'Camping accommodation',
      'All meals during trek',
      'Experienced trek leader',
      'Forest permits & camping permissions',
      'Basic first aid',
      'Trek support team',
    ],
    exclusions: [
      'Travel to/from Manali (your own arrangement)',
      'Personal expenses',
      'Additional snacks & beverages',
      'Travel insurance',
      'Anything not listed above',
    ],
    is_active: true,
    is_recommended: false,
  };
  if (bhriguId) {
    must((await supabase.from('treks').update(bhriguRow).eq('id', bhriguId)).error, 'update Bhrigu');
  } else {
    const { data, error } = await supabase.from('treks').insert(bhriguRow).select('id').single();
    must(error, 'create Bhrigu');
    bhriguId = data.id;
  }
  await replaceChildren(bhriguId);
  await insertPricing(bhriguId, [
    { min_group_size: 1, max_group_size: 5, price_per_person: 4800,
      notes: `${ANCHOR_LINE} ₹4,800 is the best/last price for groups under 6.` },
    { min_group_size: 6, max_group_size: null, price_per_person: 4500,
      notes: `${ANCHOR_LINE} ₹4,500 is the best/last price for groups of 6 or more — proactively offer when they're close to 6.` },
  ]);
  await insertItinerary(bhriguId, [
    { day_number: 1, title: 'Manali → Gulaba → Rola Kholi',
      description: 'Pickup from Manali Bus Stand, drive to Gulaba, then trek to Rola Kholi camp (6–8 km). Overnight camping under the stars.',
      altitude_ft: 11500, distance_km: 7, duration_hrs: 5, meals: ['Dinner'], accommodation: 'Camp at Rola Kholi' },
    { day_number: 2, title: 'Bhrigu Lake & back to camp',
      description: 'Early morning trek to Bhrigu Lake (4,300 m / 14,100 ft). Explore the lake and return to camp for an overnight stay.',
      altitude_ft: 14100, distance_km: 12, duration_hrs: 8, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Rola Kholi' },
    { day_number: 3, title: 'Descend to Manali',
      description: 'After breakfast, descend to Gulaba and drive back to Manali. Drop at Manali Bus Stand.',
      altitude_ft: 6700, distance_km: 6, duration_hrs: 4, meals: ['Breakfast'], accommodation: 'Drop at Manali Bus Stand' },
  ]);
  await insertFaqs(bhriguId, [
    { category: 'cancellation',
      question: 'What is the cancellation policy for the Bhrigu Lake trek?',
      answer: 'Cancellation must be informed at least 5 days before departure for a refund. After that, refunds are difficult as arrangements are pre-booked. For cancellations, email helloyaatraexpress@gmail.com.',
      trigger_keywords: ['cancel', 'refund', 'cancellation', 'money back', 'policy'] },
  ]);
  log('Created/updated Bhrigu Lake Trek (pricing, itinerary, cancellation FAQ)');

  // ════════════════════════════════════════════════════════════
  // 5. GLOBAL cancellation FAQ — make it non-conflicting
  //    (per-trek policies above are the real source of truth)
  // ════════════════════════════════════════════════════════════
  must((await supabase.from('faq_knowledge')
    .delete()
    .is('trek_id', null)
    .eq('category', 'cancellation')).error, 'clear global cancellation faq');
  must((await supabase.from('faq_knowledge').insert({
    trek_id: null,
    category: 'cancellation',
    question: 'What is the cancellation policy?',
    answer: 'Cancellation terms vary by trek — the earlier you cancel, the more you get back. Chopta Chandrashila: 30+ days 70%, 21–30 days 50%, 11–20 days 30%, 10 days or less no refund. Bhrigu Lake: inform at least 5 days before for a refund. For any cancellation, email helloyaatraexpress@gmail.com and the team will help.',
    trigger_keywords: ['cancel', 'refund', 'cancellation', 'money back', 'policy'],
  })).error, 'insert global cancellation faq');
  log('Replaced global cancellation FAQ with a per-trek, non-conflicting version');

  // ════════════════════════════════════════════════════════════
  // VERIFY
  // ════════════════════════════════════════════════════════════
  const { data: active } = await supabase.from('treks')
    .select('name, base_price_per_person').eq('is_active', true).order('name');
  console.log('\n✅ Migration 002 complete. Active treks now:');
  for (const t of active) log(`• ${t.name} — from ₹${t.base_price_per_person.toLocaleString('en-IN')}`);
  console.log('');
}

run().catch((e) => { console.error('❌ Migration failed:', e); process.exit(1); });
