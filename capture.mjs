// İTÜ cafeteria menu capturer (offline/backup archive for "İTÜ Yemek & Kalori").
//
// Primary source in the app is İTÜ Mobil's own public API
// (mobil.itu.edu.tr/v2/service/service.aspx?method=GetDailyFoodMenuByDate),
// which is date-addressable for any day. This cron mirrors a window of days into
// static JSON on GitHub Pages so the app has a fast offline fallback and a
// forward buffer even when the device is offline.
//
// Writes docs/menu/<YYYY-MM-DD>-<lunch|dinner>.json + docs/menu/index.json.

import { writeFile, mkdir, readFile } from 'node:fs/promises';

const BASE = 'https://mobil.itu.edu.tr/v2/service/service.aspx';
const UA = 'okhttp/4.12.0';
const OUT_DIR = 'docs/menu';
const PAST_DAYS = 7;   // also mirror the last week (İTÜ keeps history)
const FUTURE_DAYS = 14; // and two weeks ahead (İTÜ publishes upcoming days)

const VEG_HINT = /VEJETARYEN|VEGAN|ZEYTINYAGLI|NOHUTLU|MERCIMEK|SEBZE/;

function normalizeName(raw) {
  return (raw || '')
    .toLocaleUpperCase('tr')
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '');
}

function categoryFromType(t) {
  const n = normalizeName(t);
  if (n.includes('CORBA')) return 'soup';
  if (n.includes('ANAYEMEK')) return 'main';
  if (n.includes('YANYEMEK')) return 'side';
  return 'extra';
}

function parseTrNumber(raw) {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function besinValue(list, keyNorm) {
  if (!Array.isArray(list)) return 0;
  const hit = list.find((b) => normalizeName(b.ValueName || '').includes(keyNorm));
  return hit ? parseTrNumber(hit.Amount) : 0;
}

/** İstanbul-local date, N days from today, as YYYY-MM-DD. */
function istanbulDatePlus(days) {
  const base = new Date();
  // shift by days in UTC then format in Istanbul tz
  const shifted = new Date(base.getTime() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(shifted);
}

async function fetchMenu(date, meal) {
  const key = meal === 'dinner' ? 1 : 0; // 0 Öğle, 1 Akşam
  const url = `${BASE}?method=GetDailyFoodMenuByDate&MenuTemplateKeyId=${key}&Day=${encodeURIComponent(date)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    const list = Array.isArray(data.FoodList) ? data.FoodList : [];
    const dishes = list
      .filter((f) => f && typeof f.FoodName === 'string' && f.FoodName.trim())
      .map((f) => {
        const category = categoryFromType(f.FoodType || '');
        return {
          id: 0,
          name: f.FoodName.trim(),
          category,
          kcal: besinValue(f.FoodBesinList, 'ENERJI'),
          protein: besinValue(f.FoodBesinList, 'PROTEIN'),
          carb: besinValue(f.FoodBesinList, 'KARBONHIDRAT'),
          fat: besinValue(f.FoodBesinList, 'YAG'),
          vegetarian: category === 'main' && VEG_HINT.test(normalizeName(f.FoodName)),
        };
      });
    return dishes.length ? { date, meal, label: data.Baslik || '', dishes } : null;
  } catch (e) {
    console.error(`fetch ${date} ${meal} failed:`, e.message);
    return null;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const indexPath = `${OUT_DIR}/index.json`;
  let index = [];
  try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { index = []; }
  const seen = new Set(index);
  let wrote = 0;

  for (let d = -PAST_DAYS; d <= FUTURE_DAYS; d++) {
    const date = istanbulDatePlus(d);
    for (const meal of ['lunch', 'dinner']) {
      const menu = await fetchMenu(date, meal);
      if (!menu) continue;
      const payload = { ...menu, capturedAt: new Date().toISOString() };
      await writeFile(`${OUT_DIR}/${date}-${meal}.json`, JSON.stringify(payload, null, 2), 'utf8');
      seen.add(`${date}-${meal}`);
      wrote++;
    }
  }

  const merged = [...seen].sort();
  await writeFile(indexPath, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`Wrote/updated ${wrote} menu files. Index has ${merged.length} entries.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
