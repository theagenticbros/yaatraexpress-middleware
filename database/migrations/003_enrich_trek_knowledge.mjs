// ============================================================
// MIGRATION 003 — Enrich trek knowledge from the brochure PDFs
// ------------------------------------------------------------
// Source: MASTER_PROMPTS/{Chopta, Bhrigu, Hampta} brochure .md files
//
// Makes the AI noticeably smarter by loading the depth that was
// only in the brochures into Supabase (where getTrekContext feeds
// it into the prompt per trek):
//   - Richer day-by-day itineraries (named places, elevations,
//     distances, durations, highlights)
//   - A fuller per-trek FAQ knowledge base (place descriptions,
//     how-to-reach, payment, documents, rentals, terms, packing)
//
// Scrubbing: brochures contain whitelabel OCR artifacts
// ("Great Indian Adventure", "Himalayas Griffon") — these are
// NEVER stored. The only brand is Yaatra Express.
//
// NOT changed: pricing (brochure "From ₹6000" for Chopta conflicts
// with the ₹5,500 sales-playbook anchor — left for the owner to
// confirm before any change).
//
// Idempotent. Run from the middleware/ folder:
//   node database/migrations/003_enrich_trek_knowledge.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = await import(pathToFileURL(require.resolve('@supabase/supabase-js')).href);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const log = (...a) => console.log('  ', ...a);
function must(error, what) {
  if (error) { console.error(`❌ ${what}:`, error.message); process.exit(1); }
}
async function trekId(slug) {
  const { data, error } = await supabase.from('treks').select('id').eq('slug', slug).maybeSingle();
  must(error, `lookup ${slug}`);
  if (!data) { console.error(`❌ trek not found: ${slug}`); process.exit(1); }
  return data.id;
}
async function setItinerary(id, rows) {
  must((await supabase.from('trek_itinerary').delete().eq('trek_id', id)).error, 'clear itinerary');
  must((await supabase.from('trek_itinerary').insert(rows.map(r => ({ trek_id: id, ...r })))).error, 'insert itinerary');
}
async function setFaqs(id, rows) {
  // Take over the trek-specific FAQ set (idempotent re-seed).
  must((await supabase.from('faq_knowledge').delete().eq('trek_id', id)).error, 'clear trek faqs');
  must((await supabase.from('faq_knowledge').insert(rows.map(r => ({ trek_id: id, ...r })))).error, 'insert trek faqs');
}

async function run() {
  console.log('\n🔧 Migration 003 — enriching trek knowledge from brochures\n');

  // ════════════════════════════════════════════════════════════
  // CHOPTA CHANDRASHILA
  // ════════════════════════════════════════════════════════════
  const chopta = await trekId('chopta-tungnath-trek');
  await setItinerary(chopta, [
    { day_number: 1, title: 'Departure → Devprayag → Sari Village',
      description: 'Overnight departure from Delhi the previous night (report 9:30–10:30 PM at Akshardham Metro Station Parking), ~240 km to Rishikesh (5–6 hrs) with music & games onboard. Early arrival at Rishikesh, then ~210 km (8–9 hrs) via Devprayag Sangam and Dhari Devi Temple to Sari Village. Evening: village walk, bonfire and group activities.',
      altitude_ft: 6600, distance_km: 0, duration_hrs: 0, meals: ['Dinner'], accommodation: 'Homestay/campsite at Sari Village' },
    { day_number: 2, title: 'Tungnath & Chandrashila Summit',
      description: 'Drive to the Chopta base via Baniyakund. Trek ~5.5 km (3–4 hrs) to Tungnath (3,680 m) — the world’s highest Shiva temple and one of the Panch Kedar — then 1.5 km further up a steep final ascent to Chandrashila summit (13,549 ft) for 360° views of Nanda Devi, Trishul, Kedar Dome and Chaukhamba. Return to Sari; dinner and rest.',
      altitude_ft: 13549, distance_km: 5.5, duration_hrs: 4, meals: ['Breakfast', 'Dinner'], accommodation: 'Homestay/campsite at Sari Village' },
    { day_number: 3, title: 'Deoria Tal & Departure',
      description: 'Morning trek ~3.5 km (2–3 hrs) to Deoria Tal (2,438 m, ~7,999 ft) — a crystal-clear lake that mirrors Chaukhamba peak. Free time for reflection and photography. Optional Omkareshwar Temple visit. Depart ~12–1 PM, reach Rishikesh by evening, overnight journey back to Delhi.',
      altitude_ft: 7999, distance_km: 3.5, duration_hrs: 3, meals: ['Breakfast'], accommodation: 'Overnight travel' },
  ]);
  await setFaqs(chopta, [
    { category: 'place', question: 'Tell me about Tungnath temple',
      answer: 'Tungnath sits at 3,680 m and is the world’s highest Shiva temple — one of the five Panch Kedar shrines. It’s a serene, scenic ~3.5 km trail from Chopta with panoramic views of the snow-clad Garhwal Himalayas. A spiritual, peaceful high point of the trek.',
      trigger_keywords: ['tungnath', 'temple', 'shiva', 'panch kedar'] },
    { category: 'place', question: 'What is Chandrashila summit like?',
      answer: 'Chandrashila (the "Moon Rock") is ~1.5 km beyond Tungnath at about 4,000 m (13,549 ft). The final ascent is a bit steep but worth it — 360° views of Nanda Devi, Trishul, Kedar Dome and Chaukhamba. The sunrise from here is unreal.',
      trigger_keywords: ['chandrashila', 'summit', 'peak', 'sunrise', 'moon rock'] },
    { category: 'place', question: 'What is Deoria Tal?',
      answer: 'Deoria Tal is a crystal-clear lake at 2,438 m near Sari Village — an easy ~2.5–3.5 km trek. It mirrors the Chaukhamba peak in its waters and is perfect for photography, stargazing and quiet nature walks.',
      trigger_keywords: ['deoria', 'deoriatal', 'lake', 'tal'] },
    { category: 'cancellation', question: 'What is the cancellation policy for Chopta Chandrashila?',
      answer: '30+ days before: 70% refund. 21–30 days: 50%. 11–20 days: 30%. 10 days or less: no refund. No refund for unused services or itinerary changes. Refunds are processed within 10 working days. Notify via email: helloyaatraexpress@gmail.com.',
      trigger_keywords: ['cancel', 'refund', 'cancellation', 'policy', 'money back'] },
    { category: 'terms', question: 'What are the key terms and conditions?',
      answer: 'Booking is confirmed only after email confirmation. No refund if you exit after the trek starts. Adventure activities carry inherent risk; weather and terrain are beyond our control. Basic fitness is required — please consult your doctor before joining. Open to solo travellers, couples, friends and families.',
      trigger_keywords: ['terms', 'conditions', 'rules', 'liability', 'consent'] },
    { category: 'gear', question: 'What should I pack for Chopta?',
      answer: 'Trekking shoes, warm layers, a cap, a poncho/rain layer, toiletries, trek pants, and a power bank for backup. I can send a full checklist if you’d like.',
      trigger_keywords: ['pack', 'packing', 'carry', 'essential', 'bring', 'checklist'] },
    { category: 'transport', question: 'Where is the pickup for Chopta?',
      answer: 'Two options: Delhi — Akshardham Metro Station Parking, overnight departure 9:30–10:30 PM; or Rishikesh — Tapovan / Lakshman Jhula area, pickup at 6:00 AM. Drop is back to the same point.',
      trigger_keywords: ['pickup', 'reach', 'delhi', 'rishikesh', 'start point', 'how to reach'] },
  ]);
  log('Chopta Chandrashila — itinerary + 7 knowledge FAQs');

  // ════════════════════════════════════════════════════════════
  // BHRIGU LAKE
  // ════════════════════════════════════════════════════════════
  const bhrigu = await trekId('bhrigu-lake-trek');
  await setItinerary(bhrigu, [
    { day_number: 1, title: 'Manali → Gulaba → Rola Kholi',
      description: 'Pickup from Manali Bus Stand and a scenic drive to Gulaba. Trek 6–8 km through forest and open meadows to Rola Kholi camp. Settle in and overnight camping under the stars.',
      altitude_ft: 11500, distance_km: 7, duration_hrs: 5, meals: ['Dinner'], accommodation: 'Camp at Rola Kholi' },
    { day_number: 2, title: 'Summit Day — Bhrigu Lake',
      description: 'Early morning trek toward the lake. Reach Bhrigu Lake at 4,300 m (14,100 ft) — a sacred high-altitude alpine lake with panoramic Pir Panjal range views. Explore the lake, then return to Rola Kholi for overnight camping.',
      altitude_ft: 14100, distance_km: 12, duration_hrs: 8, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Rola Kholi' },
    { day_number: 3, title: 'Rola Kholi → Gulaba → Manali',
      description: 'Breakfast at camp, then descend through the meadows to Gulaba and drive back to Manali. Drop at Manali Bus Stand.',
      altitude_ft: 6700, distance_km: 7, duration_hrs: 4, meals: ['Breakfast'], accommodation: 'Drop at Manali Bus Stand' },
  ]);
  await setFaqs(bhrigu, [
    { category: 'place', question: 'Why do the Bhrigu Lake trek?',
      answer: 'It’s one of Himachal’s most rewarding short Himalayan adventures — starting from Gulaba and rising to 4,300 m, with sweeping meadows, wide open skies and a magical high-altitude alpine lake. Great for both beginners and experienced trekkers who want to truly disconnect.',
      trigger_keywords: ['why', 'about', 'bhrigu', 'special', 'worth it'] },
    { category: 'cancellation', question: 'What is the cancellation policy for Bhrigu Lake?',
      answer: 'Advance bookings can be refunded if you inform us at least 5 days before departure. After that, transport, campsites and permits are usually pre-booked, so refunds become difficult. We always try our best to help in genuine emergencies — email helloyaatraexpress@gmail.com.',
      trigger_keywords: ['cancel', 'refund', 'cancellation', 'policy', 'money back'] },
    { category: 'gear', question: 'What should I pack for Bhrigu Lake?',
      answer: 'A 40–50 L backpack packed light: trekking shoes, a warm jacket, rain protection, water bottle, sunglasses, sunscreen, personal medicines, a power bank and extra socks. Layer up — mountain nights get cold.',
      trigger_keywords: ['pack', 'packing', 'carry', 'bring', 'checklist', 'essential'] },
    { category: 'general', question: 'What should I expect on the trek?',
      answer: 'Mountain life is simple by design — expect basic camps, changing weather, limited facilities and raw natural surroundings. We provide all the essentials for a safe, comfortable trek; come with an open mind and an adventurous spirit and the mountains give it all back.',
      trigger_keywords: ['expect', 'camp', 'facilities', 'comfort', 'basic', 'what is it like'] },
    { category: 'transport', question: 'Where does the Bhrigu Lake trek start?',
      answer: 'It starts and ends at Manali Bus Stand. Reaching Manali is your own arrangement — overnight Volvo buses from Delhi are the most popular option. Tell me your city and I’ll suggest the best way to reach.',
      trigger_keywords: ['start', 'pickup', 'reach', 'manali', 'how to reach', 'start point'] },
  ]);
  log('Bhrigu Lake — itinerary + 5 knowledge FAQs');

  // ════════════════════════════════════════════════════════════
  // HAMPTA PASS
  // ════════════════════════════════════════════════════════════
  const hampta = await trekId('hampta-pass-trek');
  await setItinerary(hampta, [
    { day_number: 1, title: 'Manali → Jobra → Chika',
      description: 'Drive from Manali to Jobra (10 km, ~2 hrs), then trek to Chika (2 km, ~2 hrs) along the Rani Nallah river. Camp at Chika (10,100 ft) amid scenic valleys.',
      altitude_ft: 10100, distance_km: 2, duration_hrs: 2, meals: ['Dinner'], accommodation: 'Camp at Chika (Rani Nallah)' },
    { day_number: 2, title: 'Chika → Balu Ka Ghera',
      description: 'Trek 8 km (5–6 hrs) through rocky banks and meadows, crossing the Hampta river. Camp at Balu Ka Ghera amidst mountains and glaciers, with first views of the big peaks.',
      altitude_ft: 11900, distance_km: 8, duration_hrs: 6, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Balu Ka Ghera' },
    { day_number: 3, title: 'Balu Ka Ghera → Hampta Pass → Shea Goru',
      description: 'The big day — a steep ascent to Hampta Pass (14,100 ft) with breathtaking views, then a descent through snow and rocky terrain to Shea Goru (12,900 ft). 14 km, 8–9 hrs.',
      altitude_ft: 14100, distance_km: 14, duration_hrs: 9, meals: ['Breakfast', 'Packed Lunch', 'Dinner'], accommodation: 'Camp at Shea Goru' },
    { day_number: 4, title: 'Shea Goru → Chatru → Chandratal',
      description: 'Trek 8 km (4–5 hrs) through river crossings and glacial paths to Chatru, then a 70 km round-trip drive (3–4 hrs) to the mesmerizing Chandratal Lake. Return to Chatru for camping.',
      altitude_ft: 12100, distance_km: 8, duration_hrs: 5, meals: ['Breakfast', 'Lunch', 'Dinner'], accommodation: 'Camp at Chatru' },
    { day_number: 5, title: 'Chatru → Manali',
      description: 'Scenic 85 km drive (5–6 hrs) back to Manali through the Atal Tunnel. End of trek; drop at Manali Bus Stand.',
      altitude_ft: 6700, distance_km: 0, duration_hrs: 0, meals: ['Breakfast'], accommodation: 'Drop at Manali Bus Stand' },
  ]);
  await setFaqs(hampta, [
    { category: 'booking', question: 'How do I book / pay for Hampta Pass?',
      answer: 'Pay ₹1,000 per person to reserve your seat. The remaining amount is paid 2 days before the trek (or on the date of arrival). I’ll share the payment details once your date and group size are set.',
      trigger_keywords: ['book', 'booking', 'pay', 'payment', 'advance', 'reserve', 'confirm'] },
    { category: 'trek_specific', question: 'Is Chandratal Lake included in Hampta Pass?',
      answer: 'Yes — the Chandratal Lake visit is included on Day 4 (a 70 km round-trip drive from Chatru). One of India’s most beautiful high-altitude lakes, at no extra charge.',
      trigger_keywords: ['chandratal', 'chandra tal', 'lake', 'included'] },
    { category: 'transport', question: 'How do I reach Manali for the trek?',
      answer: 'By air: Bhuntar (Kullu-Manali) Airport ~50 km away, with flights from Delhi & Chandigarh, then a ~2 hr cab/bus. By train: Chandigarh station (~290 km), then 8–10 hrs by bus/taxi. By road: ~550 km from Delhi (12–14 hrs) — overnight Volvo buses from Delhi are the popular choice.',
      trigger_keywords: ['reach', 'how to reach', 'manali', 'airport', 'train', 'bus', 'volvo', 'delhi'] },
    { category: 'documents', question: 'What documents do I need to carry?',
      answer: 'A government-issued ID (Aadhaar/Driving Licence), your own and a guardian/emergency contact number, an email address, and a signed consent letter. We’ll guide you on the consent form at booking.',
      trigger_keywords: ['document', 'documents', 'id', 'aadhar', 'aadhaar', 'license', 'consent', 'proof'] },
    { category: 'gear', question: 'Do you rent trek equipment, and what does it cost?',
      answer: 'Yes — for the complete trek: jacket ₹500, trek shoes ₹500, walking sticks ₹150, head torch ₹200, woolen cap ₹200, woolen socks ₹150, poncho ₹200. Just tell me what you need and I’ll add it.',
      trigger_keywords: ['rent', 'rental', 'hire', 'equipment', 'jacket', 'shoes', 'pole', 'stick', 'torch'] },
    { category: 'gear', question: 'What should I pack for Hampta Pass?',
      answer: 'Warm layers are critical: fleece/down jacket, 3 warm layers (5 in winter), thermals, woolen cap, gloves, neck gaiter, woolen + extra socks, 2 trek pants, quick-dry t-shirts, a 40–60 L backpack with rain cover, trekking shoes, LED torch, 1 L water bottle, sunglasses, SPF 50/70 sunscreen and lip balm, and a poncho. I can send the full checklist.',
      trigger_keywords: ['pack', 'packing', 'carry', 'bring', 'clothes', 'checklist', 'essential', 'warm'] },
    { category: 'general', question: 'Why book this trek with Yaatra Express?',
      answer: 'You’re in safe, experienced hands — certified, fun-loving trek leaders and guides, high-quality tents and sleeping bags, hygienic meals throughout, and a trek certificate. Great for solo travellers (safe for solo women), couples and groups of friends alike.',
      trigger_keywords: ['why', 'trust', 'safe', 'experienced', 'reliable', 'why you', 'reviews'] },
  ]);
  log('Hampta Pass — itinerary + 7 knowledge FAQs');

  // ════════════════════════════════════════════════════════════
  // VERIFY
  // ════════════════════════════════════════════════════════════
  for (const slug of ['chopta-tungnath-trek', 'bhrigu-lake-trek', 'hampta-pass-trek']) {
    const id = await trekId(slug);
    const { count: itc } = await supabase.from('trek_itinerary').select('*', { count: 'exact', head: true }).eq('trek_id', id);
    const { count: fqc } = await supabase.from('faq_knowledge').select('*', { count: 'exact', head: true }).eq('trek_id', id);
    log(`${slug}: ${itc} itinerary days, ${fqc} trek FAQs`);
  }
  console.log('\n✅ Migration 003 complete.\n');
}

run().catch((e) => { console.error('❌ Migration failed:', e); process.exit(1); });
