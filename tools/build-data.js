#!/usr/bin/env node
/*
 * Regenerates the derived data files in ../data.
 *
 *   node tools/build-data.js
 *
 * Needs the source datasets, which are NOT committed (they are large and only
 * used here). Install them first, from the repo root:
 *
 *   npm install --no-save world-atlas@2.0.2 world-countries@5.1.0 all-the-cities@3.1.0
 *
 * Produces:
 *   data/iso-lookup.json  ISO 3166-1 numeric -> alpha-3 + display name.
 *                         world-atlas identifies countries by NUMERIC id
 *                         ("620"), not alpha-3, so every join goes through here.
 *   data/cities.json      ~1000 major cities for the "add a place" typeahead.
 *
 * data/places.json is hand-maintained and is never written by this script.
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "data");

// Enough cities to reach down to roughly 80k population. 1000 sounds like
// plenty until you notice it stops around 600k and cannot find Porto or
// Valparaíso — ordinary travel destinations. Clicking the map still covers
// anything missing, but the typeahead should handle the common case.
const CITY_TARGET = 5000;

function load(mod, what) {
  try {
    return require(mod);
  } catch (e) {
    console.error(`\nMissing dataset: ${mod} (${what})`);
    console.error("Install the sources first:\n");
    console.error("  npm install --no-save world-atlas@2.0.2 world-countries@5.1.0 all-the-cities@3.1.0\n");
    process.exit(1);
  }
}

const topo = load("world-atlas/countries-110m.json", "country geometry");
const countries = load("world-countries/countries.json", "ISO codes");
const cities = load("all-the-cities", "city list");

/* ---------- iso-lookup.json ---------- */

// Keyed by the numeric id exactly as world-atlas writes it, so the join in
// js/map.js is a plain property read with no coercion.
const byNumeric = {};
for (const c of countries) {
  if (!c.ccn3) continue;
  byNumeric[c.ccn3] = { iso3: c.cca3, name: c.name.common };
}

// Natural Earth draws a few territories that ISO 3166-1 does not code. They
// arrive with no usable `id`, so key them by the name Natural Earth uses and
// give them the user-assigned alpha-3 that is conventional for each. Without
// this they are simply untintable.
const UNCODED = {
  "N. Cyprus": "CYN",
  "Somaliland": "SOL",
  "Kosovo": "XKX",
  "W. Sahara": "ESH"
};

const geoms = topo.objects.countries.geometries;
const synthesised = [];
for (const g of geoms) {
  const id = String(g.id);
  if (byNumeric[id]) continue;
  const name = (g.properties && g.properties.name) || null;
  const iso3 = name && UNCODED[name];
  if (!iso3) {
    console.error(`FATAL: uncoded geometry with no mapping: id=${id} name=${name}`);
    console.error("Add it to the UNCODED table above.");
    process.exit(1);
  }
  byNumeric[id] = { iso3, name };
  synthesised.push(`${name} -> ${iso3}`);
}

// The reverse direction is what the app actually needs most: iso3 -> numeric.
const lookup = {
  // Written as two maps so neither side needs a linear scan at runtime.
  numericToIso3: {},
  iso3ToNumeric: {},
  names: {}
};
for (const [num, rec] of Object.entries(byNumeric)) {
  lookup.numericToIso3[num] = rec.iso3;
  lookup.iso3ToNumeric[rec.iso3] = num;
  lookup.names[rec.iso3] = rec.name;
}

// Hard assertion: every geometry in the map must resolve to an alpha-3.
const missing = geoms.filter(g => !lookup.numericToIso3[String(g.id)]);
if (missing.length) {
  console.error("FATAL: geometries with no alpha-3:", missing.map(g => g.id));
  process.exit(1);
}

fs.writeFileSync(path.join(OUT, "iso-lookup.json"), JSON.stringify(lookup) + "\n");
console.log(
  `iso-lookup.json  ${geoms.length} geometries, all resolved` +
  (synthesised.length ? ` (uncoded: ${synthesised.join(", ")})` : "")
);

/* ---------- cities.json ---------- */

const alpha2ToIso3 = {};
for (const c of countries) if (c.cca2) alpha2ToIso3[c.cca2] = c.cca3;

const ranked = cities
  .filter(c => c.population > 0 && c.loc && alpha2ToIso3[c.country])
  .sort((a, b) => b.population - a.population);

// Take the largest cities, but guarantee at least one per country that the map
// can actually draw — otherwise small countries are unreachable in the
// typeahead and you can never tint them without clicking the map.
const drawableIso3 = new Set(geoms.map(g => lookup.numericToIso3[String(g.id)]));
const picked = [];
const seenCountry = new Set();
const seenKey = new Set();

function push(c) {
  const iso3 = alpha2ToIso3[c.country];
  const key = c.name + "|" + iso3;
  if (seenKey.has(key)) return false;
  seenKey.add(key);
  seenCountry.add(iso3);
  picked.push({
    n: c.name,
    c: iso3,
    // Stored [lon, lat] — the order d3 projections take, so nothing has to
    // remember to swap it downstream.
    p: [round(c.loc.coordinates[0]), round(c.loc.coordinates[1])]
  });
  return true;
}
const round = n => Math.round(n * 1e4) / 1e4;

for (const c of ranked) {
  if (picked.length >= CITY_TARGET) break;
  push(c);
}

// Backfill countries the population ranking missed.
for (const iso3 of drawableIso3) {
  if (seenCountry.has(iso3)) continue;
  const best = ranked.find(c => alpha2ToIso3[c.country] === iso3);
  if (best) push(best);
}

picked.sort((a, b) => a.n.localeCompare(b.n));

fs.writeFileSync(path.join(OUT, "cities.json"), JSON.stringify(picked) + "\n");
const kb = (fs.statSync(path.join(OUT, "cities.json")).size / 1024).toFixed(0);
const covered = [...drawableIso3].filter(c => seenCountry.has(c)).length;
const uncovered = [...drawableIso3].filter(c => !seenCountry.has(c));
console.log(
  `cities.json      ${picked.length} cities, ${covered}/${drawableIso3.size} drawable countries covered, ${kb}KB` +
  (uncovered.length ? `\n                 no city for: ${uncovered.join(", ")}` : "")
);
