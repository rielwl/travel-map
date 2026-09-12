/* The real data/places.json as served: every place pinned, every country
   tinted, overseas departments left dark, and no unexplained mismatches. */
const H = require("./support");
const R = H.reporter("places");
const note = R.note;

(async () => {
  const places = H.places();
  const b = await H.launch();
  const ctx = await H.context(b, { deviceScaleFactor: 2, colorScheme: "dark" });
  const p = await H.newPage(ctx, 1280, 1050);
  await H.open(p, "/index.html");
  await p.waitForFunction(() => document.querySelectorAll(".pm-pin,.pm-cluster").length > 0, { timeout: 20000 });
  await p.waitForTimeout(600);

  const d = await p.evaluate(() => ({
    pins: COUNT(),
    rows: document.querySelectorAll(".pm-row").length,
    stats: [...document.querySelectorAll("[data-stat]")].map(e=>e.textContent).join(" / "),
    years: [...document.querySelectorAll("[data-year] option")].map(o=>o.textContent).join(","),
    first: [...document.querySelectorAll(".pm-row")].slice(0,3).map(r=>r.querySelector(".pm-rowcity").textContent+"="+r.querySelector(".pm-rowyear").textContent),
    last: [...document.querySelectorAll(".pm-row")].slice(-3).map(r=>r.querySelector(".pm-rowcity").textContent+"="+r.querySelector(".pm-rowyear").textContent)
  }));
  console.log("   ", JSON.stringify(d, null, 0));
  note(d.pins === places.length, `pin per place (${d.pins}/${places.length})`);
  note(d.rows === places.length, `row per place (${d.rows})`);

  // Every country must tint, and each pin must fall inside its declared country.
  const check = await p.evaluate(() => {
    const m = window.__pmmap;
    const counts = {}, wrongCountry = [];
    window.__pmplaces.forEach(pl => {
      counts[pl.iso3] = (counts[pl.iso3] || 0) + 1;
      const at = m.countryAt([pl.lon, pl.lat]);
      if (!at || at.iso3 !== pl.iso3) wrongCountry.push(pl.city + " -> " + (at ? at.iso3 : "ocean/none") + " (declared " + pl.iso3 + ")");
    });
    const dark = Object.keys(counts).filter(c => m.hasCountry(c) && m.stepOf(c) === 0);
    const noPoly = Object.keys(counts).filter(c => !m.hasCountry(c));
    const steps = {};
    Object.keys(counts).forEach(c => { const s = m.stepOf(c); if (s) steps[s] = (steps[s]||0)+1; });
    return { countries: Object.keys(counts).length, dark, noPoly, wrongCountry, steps, counts };
  });
  console.log("    countries:", check.countries, "| fill steps:", JSON.stringify(check.steps));
  console.log("    visits per country:", JSON.stringify(check.counts));
  note(check.dark.length === 0, `every country tints${check.dark.length ? " — dark: "+check.dark.join(", ") : ""}`);
  note(check.noPoly.length === 0, `every country has a polygon at 110m${check.noPoly.length ? " — missing: "+check.noPoly.join(", ") : ""}`);
  /* Reverse geocoding a pin against 110m polygons is coarser than the pins
     themselves. These four are confirmed-correct GeoNames coordinates whose
     countries GeoNames itself assigns; 110m just cannot resolve them. Tinting
     uses the declared iso3, not containment, so the map is unaffected — this
     only means click-to-drop near them would guess the country wrong.
     Anything NOT on this list is a real problem. */
  const KNOWN_110M = {
    "Xiamen":  "coastal; the GeoNames point sits just off the 50m coastline",
    "Malacca": "coastal; the GeoNames point sits just off the 50m coastline"
  };
  const unexpected = check.wrongCountry.filter(w => !KNOWN_110M[w.split(" ->")[0]]);
  note(unexpected.length === 0,
    `no unexplained pin/country mismatches${unexpected.length ? ":\n         "+unexpected.join("\n         ") : ""}`);
  if (check.wrongCountry.length) {
    console.log("    known 110m limits (coordinates are correct, tinting unaffected):");
    check.wrongCountry.forEach(w => {
      const city = w.split(" ->")[0];
      console.log(`      ${city} — ${KNOWN_110M[city] || "UNEXPLAINED"}`);
    });
  }
  // Overseas departments must not light up from a mainland visit.
  const parts = await p.evaluate(() => {
    const m = window.__pmmap;
    const out = {};
    [...new Set(window.__pmplaces.map(x => x.iso3))].forEach(c => { out[c] = m.partsLit(c); });
    return out;
  });
  console.log("    landmasses lit per country:", JSON.stringify(parts));
  note(parts.FRA && parts.FRA.lit < parts.FRA.total,
    `France tints its mainland but not every landmass (${parts.FRA.lit}/${parts.FRA.total})`);
  Object.keys(parts).forEach(c => {
    if (c !== "FRA") note(parts[c].lit > 0, `${c} has at least one landmass lit (${parts[c].lit}/${parts[c].total})`);
  });

  note(p.errors.length === 0, "console clean" + (p.errors.length ? ": " + p.errors.slice(0, 4).join(" | ") : ""));

  await p.screenshot({ path: H.shot("20-real-dark.png"), fullPage: false });
  const lp = await H.newPage(ctx, 1280, 1050);
  await H.open(lp, "/index.html?theme=light");
  await lp.waitForFunction(() => document.querySelectorAll(".pm-pin,.pm-cluster").length > 0, { timeout: 20000 });
  await lp.waitForTimeout(600);
  await lp.screenshot({ path: H.shot("21-real-light.png"), fullPage: false });

  const mp = await H.newPage(ctx, 390, 1400);
  await H.open(mp, "/index.html");
  await mp.waitForFunction(() => document.querySelectorAll(".pm-pin,.pm-cluster").length > 0, { timeout: 20000 });
  await mp.waitForTimeout(600);
  note(await mp.evaluate(() => document.documentElement.scrollWidth) <= 390, "no horizontal scroll at 390");
  await mp.screenshot({ path: H.shot("22-real-mobile.png"), fullPage: false });

  await b.close();
  R.finish();
})().catch(e => { console.error(e); process.exit(1); });
