import rawData from '../data/fd2025-stations.csv';

/**
 * Field Day station data sourced from the official 2025 ARRL Field Day results.
 *
 * The CSV is bundled at build time (see the `asset/source` rule in
 * webpack.common.js) and arrives here as a single raw string. It is a full
 * results export with a header row and these columns (0-indexed):
 *
 *   0 Call          3 Category (class)   4 Section      10 Total CW QSOs
 *
 * Parsing happens once, at module load, so station lookups stay synchronous.
 *
 * @typedef {{callsign: string, klass: string, section: string, cwQsos: number, format: string|null}} FieldDayStation
 */

const COL_CALL = 0;
const COL_CATEGORY = 3;
const COL_SECTION = 4;
const COL_CW_QSOS = 10;

/**
 * Splits a single CSV line into fields, honoring double-quoted fields that may
 * contain commas (e.g. `"K0LD (WA0MHJ, op)"`). Escaped quotes (`""`) inside a
 * quoted field are preserved as a literal quote.
 *
 * @param {string} line - One raw CSV line.
 * @returns {string[]} The parsed field values.
 */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Extracts the on-air base callsign from a results Call field.
 *
 * Some entries annotate the operator(s), e.g. `K0LD (WA0MHJ, op)`; on the air
 * only the base call is sent, so everything from the first space or `(` is
 * dropped.
 *
 * @param {string} rawCall - The raw Call field value.
 * @returns {string} The uppercased base callsign.
 */
function baseCall(rawCall) {
  return rawCall.trim().split(/[\s(]/)[0].toUpperCase();
}

/**
 * Normalizes a Field Day class to its on-air form.
 *
 * The published results sometimes record a combined category (e.g. `4AC`,
 * `2B2`, `1AB`), but a station sends a transmitter count plus a single category
 * letter on the air (`4A`, `2B`, `1A`). Keeping the on-air value here keeps the
 * transmitted exchange and the TU-step comparison consistent.
 *
 * @param {string} category - The raw Category field from the results file.
 * @returns {string} The on-air class (digits + first A-F letter), or the
 *   original (uppercased) value if it doesn't fit the expected shape.
 */
function normalizeFieldDayClass(category) {
  const onAir = category.toUpperCase().match(/^[0-9]+[A-F]/);
  return onAir ? onAir[0] : category.toUpperCase();
}

/**
 * Classifies a callsign into one of the standard amateur formats used by the
 * "Callsign Format Options" checkboxes (e.g. `1x1`, `2x3`): a 1-2 letter prefix,
 * a single digit, then a 1-3 letter suffix. Calls that don't fit this shape
 * (portable `/` calls, digit-prefix DX like `Z31PM`, or malformed entries)
 * return null and are simply never selected while a format filter is active.
 *
 * @param {string} callsign - The base callsign.
 * @returns {string|null} A format string like `2x3`, or null if it doesn't fit.
 */
function callsignFormat(callsign) {
  const match = callsign.match(/^([A-Z]{1,2})[0-9]([A-Z]{1,3})$/);
  return match ? `${match[1].length}x${match[2].length}` : null;
}

/**
 * All usable real Field Day stations, parsed once at module load.
 *
 * Rows missing required fields, or whose class can't be normalized to a valid
 * on-air class (transmitter count + a single A-F letter), are dropped so every
 * selectable station yields a real, sendable exchange.
 *
 * @type {FieldDayStation[]}
 */
const realStations = rawData
  .split(/\r?\n/)
  .slice(1) // drop the header row
  .filter((line) => line.trim())
  .map(splitCsvLine)
  .filter(
    (cols) =>
      cols.length > COL_CW_QSOS &&
      cols[COL_CALL] &&
      cols[COL_CATEGORY] &&
      cols[COL_SECTION]
  )
  .map((cols) => {
    const callsign = baseCall(cols[COL_CALL]);
    return {
      callsign,
      klass: normalizeFieldDayClass(cols[COL_CATEGORY].trim()),
      section: cols[COL_SECTION].trim().toUpperCase(),
      cwQsos: parseInt(cols[COL_CW_QSOS], 10) || 0,
      format: callsignFormat(callsign),
    };
  })
  .filter((station) => /^[0-9]+[A-F]$/.test(station.klass));

/**
 * The subset of stations that logged at least one CW QSO in 2025. These are the
 * stations a CW operator would realistically have worked on CW.
 *
 * @type {FieldDayStation[]}
 */
const cwActiveStations = realStations.filter((station) => station.cwQsos > 0);

/**
 * Tests whether a callsign belongs to the United States.
 *
 * US amateur callsigns (including territories such as Hawaii KH6, Alaska KL7,
 * and Puerto Rico KP4) begin with K, N, W, or a letter in the A block (AA-AL).
 * This mirrors the prefix set the random generator treats as US, so the
 * "Only US calls" setting behaves identically whether stations are randomly
 * generated or drawn from the real Field Day results.
 *
 * @param {string} callsign - The base callsign (already uppercased).
 * @returns {boolean} True if the callsign is a US callsign.
 */
function isUSCallsign(callsign) {
  return /^[KNWA]/.test(callsign);
}

/**
 * Selects a random real Field Day station from the 2025 results dataset.
 *
 * Optionally restricts the pool to stations that actually made CW contacts, and
 * optionally excludes the operator's own callsign so the user is never paired
 * against themselves (their club/personal call may appear in the results). The
 * exclusion is best-effort: a bounded number of re-rolls avoids any chance of an
 * unbounded loop while making a real collision (one excluded call out of
 * thousands) overwhelmingly unlikely to slip through.
 *
 * Honors the "Callsign Format Options" selection: when a non-empty list of
 * formats is supplied, only stations whose callsign matches one of those
 * formats are eligible (mirroring how the random generator restricts formats).
 * Also honors the "Only US calls" setting: when `usOnly` is true, non-US
 * stations (the dataset includes Canadian, Mexican, and DX entries) are
 * excluded. If either filter leaves no candidates, the function returns null so
 * the caller can fall back to random generation (which also respects these
 * selections).
 *
 * @param {string|null} [excludeCallsign=null] - A callsign to skip (case-insensitive).
 * @param {boolean} [cwActiveOnly=false] - Restrict to CW-active stations.
 * @param {string[]|null} [formats=null] - Allowed callsign formats (e.g. ['1x2','2x3']).
 * @param {boolean} [usOnly=false] - Restrict to US callsigns.
 * @returns {FieldDayStation|null} A random station, or null if the pool is empty.
 */
export function getRandomRealFieldDayStation(
  excludeCallsign = null,
  cwActiveOnly = false,
  formats = null,
  usOnly = false
) {
  let pool = cwActiveOnly ? cwActiveStations : realStations;
  if (formats && formats.length > 0) {
    pool = pool.filter((station) => formats.includes(station.format));
  }
  if (usOnly) {
    pool = pool.filter((station) => isUSCallsign(station.callsign));
  }
  if (pool.length === 0) {
    return null;
  }

  const exclude = excludeCallsign ? excludeCallsign.trim().toUpperCase() : null;

  let station;
  for (let attempt = 0; attempt < 5; attempt++) {
    station = pool[Math.floor(Math.random() * pool.length)];
    if (!exclude || station.callsign !== exclude) {
      return station;
    }
  }
  return station;
}
