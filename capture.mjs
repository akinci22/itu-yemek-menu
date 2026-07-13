// İTÜ cafeteria menu capturer.
//
// Runs daily in GitHub Actions (and can be run locally with `node capture.mjs`).
// İTÜ publishes ONLY the currently-served menu with no per-date archive, so the
// only way to build browsable per-day history is to snapshot "today" every day.
// This script does exactly that and writes docs/menu/<YYYY-MM-DD>-<meal>.json,
// which GitHub Pages then serves for the app to read.
//
// Sources (both public, no auth):
//   - ituyemekmetre.com/menu : clean JSON — which meal + dish names + real kcal
//   - İTÜ bilgiekrani page    : stable `yemek=<id>` per dish (-> official macros
//                               via besin-degerleri, cached in the file forever)

import { writeFile, mkdir, readFile } from 'node:fs/promises';

const IYM_URL = 'https://www.ituyemekmetre.com/menu';
const MENU_URL = 'https://bilgiekrani.itu.edu.tr/ExternalPages/sks/yemek-menu-v2/uzerinde-calisilan/yemek-menu.aspx';
const NUT_URL = 'https://bilgiekrani.itu.edu.tr/ExternalPages/sks/yemek-menu-v2/besin-degerleri.aspx?yemek=';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const OUT_DIR = 'docs/menu';

const VEG_HINT = /VEJETARYEN|VEGAN|ZEYTINYAGLI|NOHUTLU|MERCIMEK|SEBZE/;

function normalizeName(raw) {
  return (raw || '')
    .toLocaleUpperCase('tr')
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '');
}

function categoryFromLabel(label) {
  const n = normalizeName(label);
  if (n.includes('CORBA')) return 'soup';
  if (n.includes('ANAYEMEK')) return 'main';
  if (n.includes('YANYEMEK')) return 'side';
  return 'extra';
}

function mealFromLabel(label) {
  return normalizeName(label).includes('AKSAM') ? 'dinner' : 'lunch';
}

/** Today's date in Europe/Istanbul as YYYY-MM-DD (Actions runners are UTC). */
function istanbulDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&#199;/g, 'Ç').replace(/&#231;/g, 'ç')
    .replace(/&#214;/g, 'Ö').replace(/&#246;/g, 'ö').replace(/&#220;/g, 'Ü')
    .replace(/&#252;/g, 'ü').replace(/&nbsp;/g, ' ').replace(/ /g, ' ')
    .trim();
}

function parseTrNumber(raw) {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

async function get(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ituyemekmetre: which meal + dish names/kcal/tip
async function fetchIym() {
  try {
    const txt = await get(IYM_URL, 'application/json');
    return JSON.parse(txt);
  } catch (e) {
    console.error('iym failed:', e.message);
    return null;
  }
}

// İTÜ page: [{ id, name, category }] for the current dishes
async function fetchItuRows() {
  try {
    const html = await get(MENU_URL, 'text/html');
    const rows = new Map();
    const getR = (i) => { let r = rows.get(i); if (!r) { r = { idx: i }; rows.set(i, r); } return r; };
    const cat = /hpFoodType_(\d+)"[^>]*>([^<]*)<\/a>/g;
    for (let m = cat.exec(html); m; m = cat.exec(html)) getR(Number(m[1])).category = decodeEntities(m[2].trim());
    const dish = /hpBesinDegerleri_(\d+)"[^>]*href="[^"]*yemek=(\d+)"[^>]*>([^<]*)/g;
    for (let m = dish.exec(html); m; m = dish.exec(html)) {
      const r = getR(Number(m[1]));
      r.id = Number(m[2]);
      r.name = decodeEntities(m[3].trim());
    }
    return [...rows.values()].filter((r) => r.name && r.id).sort((a, b) => a.idx - b.idx);
  } catch (e) {
    console.error('itu page failed:', e.message);
    return [];
  }
}

// Official per-dish macros from besin-degerleri (best-effort).
async function fetchNutrition(id) {
  try {
    const html = await get(NUT_URL + id, 'text/html');
    const t = html.replace(/<[^>]*>/g, ' ');
    const grab = (re) => { const m = t.match(re); return m ? parseTrNumber(m[1]) : 0; };
    const kcal = grab(/Enerji \(kcal\)\s*([\d.,]+)/);
    if (!(kcal > 0)) return null;
    return {
      kcal,
      protein: grab(/Protein \(g\)\s*([\d.,]+)/),
      carb: grab(/Karbonhidrat \(g\)\s*([\d.,]+)/),
      fat: grab(/Ya\S* \(g\)\s*([\d.,]+)/),
    };
  } catch {
    return null;
  }
}

async function main() {
  const iym = await fetchIym();
  const rows = await fetchItuRows();

  if (!iym && rows.length === 0) {
    console.error('No source reachable — nothing captured.');
    process.exit(0); // don't fail the whole job; just skip today
  }

  const date = istanbulDate();
  const label = iym && typeof iym.tarih === 'string' ? iym.tarih : '';
  const meal = label ? mealFromLabel(label) : (new Date().getUTCHours() >= 13 ? 'dinner' : 'lunch');

  // Build dishes. Prefer İTÜ-page rows (they carry ids -> official macros);
  // fall back to ituyemekmetre dishes.
  let dishes = [];
  if (rows.length) {
    for (const r of rows) {
      const category = categoryFromLabel(r.category || '');
      const nut = await fetchNutrition(r.id);
      dishes.push({
        id: r.id,
        name: r.name,
        category,
        kcal: nut ? nut.kcal : 0,
        protein: nut ? nut.protein : 0,
        carb: nut ? nut.carb : 0,
        fat: nut ? nut.fat : 0,
        vegetarian: category === 'main' && VEG_HINT.test(normalizeName(r.name)),
      });
    }
  } else if (iym && Array.isArray(iym.yemekler)) {
    for (const y of iym.yemekler) {
      if (!y || typeof y.ad !== 'string') continue;
      const category = categoryFromLabel(y.tip || '');
      dishes.push({
        id: 0,
        name: y.ad,
        category,
        kcal: Number.isFinite(y.kalori) ? Math.round(y.kalori * 10) / 10 : 0,
        protein: 0, carb: 0, fat: 0,
        vegetarian: category === 'main' && VEG_HINT.test(normalizeName(y.ad)),
      });
    }
  }

  if (dishes.length === 0) {
    console.error('Parsed 0 dishes — skipping.');
    process.exit(0);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const payload = { date, meal, label, capturedAt: new Date().toISOString(), dishes };
  const file = `${OUT_DIR}/${date}-${meal}.json`;
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${file} — ${meal}, ${dishes.length} dishes`);

  // Maintain a lightweight index of available captures.
  const indexPath = `${OUT_DIR}/index.json`;
  let index = [];
  try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { index = []; }
  const key = `${date}-${meal}`;
  if (!index.includes(key)) index.push(key);
  index.sort();
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
  console.log(`Index now has ${index.length} entries.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
