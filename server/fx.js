// USD→GYD from Demerara Bank's public rate table. Spend uses the non-cash ("Others") selling rate,
// stored per transaction so past amounts never change.
import { db, insertRow } from './db.js';

const URL = 'https://demerarabank.com/';
const MAX_AGE_MIN = 60;

function parse(html) {
  const i = html.indexOf('Foreign Exchange Rates');
  if (i < 0) throw new Error('rate table not found');
  const text = html.slice(i, i + 20000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // Each block: "<Buying|Selling> USD EUR … Notes n n … Others n n …"; USD is the first number after "Others".
  const pick = side => Number(text.match(new RegExp(`${side} USD .*?Others ([\\d.,]+)`))?.[1]?.replace(/,/g, ''));
  const sell = pick('Selling');
  const buy = pick('Buying');
  if (!(sell > 50 && sell < 1000)) throw new Error(`unexpected USD selling rate: ${sell}`);
  return { sell, buy: buy > 50 ? buy : null };
}

/** Last stored USD row, or null. */
export function lastRate() {
  return db.prepare("SELECT * FROM fx_rates WHERE currency = 'USD' ORDER BY fetched_at DESC, id DESC LIMIT 1").get() ?? null;
}

let inflight = null;
/** Current USD row: fetched from the bank if the stored one is older than an hour; falls back to the last stored one. */
export async function currentRate({ force = false } = {}) {
  const last = lastRate();
  const age = last ? (Date.now() - Date.parse(last.fetched_at.replace(' ', 'T') + 'Z')) / 60000 : Infinity;
  if (!force && age < MAX_AGE_MIN) return last;
  inflight ??= (async () => {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (CRM)' } });
      return insertRow('fx_rates', { currency: 'USD', ...parse(await res.text()) }, 'system');
    } catch (e) {
      console.error('[fx]', e.message);
      if (last) return last;
      throw new Error(`No se pudo leer la tasa de Demerara Bank: ${e.message}`);
    } finally { inflight = null; }
  })();
  return inflight;
}

/** GYD per unit of `currency` right now (1 for GYD). */
export async function gydRate(currency) {
  return currency === 'GYD' ? 1 : (await currentRate()).sell;
}
