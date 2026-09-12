/* Places with no year: sorting, the em dash, the "No year" filter, the
   kicker-less card, and the add form accepting a blank year. */
const H = require("./support");
const R = H.reporter("undated");
const note = R.note;

const P = (id, city, country, iso3, lat, lon, from) =>
  ({ id, city, country, iso3, lat, lon, from, to: "", note: "", photo: null });

const MIXED = [
  P("tokyo-2022","Tokyo","Japan","JPN",35.68,139.69,"2022"),
  P("seoul","Seoul","South Korea","KOR",37.57,126.98,""),          // undated
  P("lisbon-2019","Lisbon","Portugal","PRT",38.72,-9.14,"2019"),
  P("porto","Porto","Portugal","PRT",41.15,-8.61,""),              // undated
  P("sydney-2024","Sydney","Australia","AUS",-33.87,151.21,"2024")
];
const ALL_UNDATED = MIXED.map(p => Object.assign({}, p, { from: "", id: p.id.replace(/-\d{4}$/, "") }));




(async () => {
  const b = await H.launch();
  const ctx = await H.context(b, { deviceScaleFactor: 2 });

  console.log("\nmixed dated + undated");
  let p = await H.pageWith(ctx, MIXED);
  let d = await p.evaluate(() => ({
    pins: COUNT(),
    rows: [...document.querySelectorAll(".pm-row")].map(r => r.querySelector(".pm-rowcity").textContent + "=" + r.querySelector(".pm-rowyear").textContent),
    years: [...document.querySelectorAll("[data-year] option")].map(o => o.textContent),
    stats: [...document.querySelectorAll("[data-stat]")].map(e=>e.textContent).join(" / "),
    summary: document.querySelector("[data-summary]").textContent
  }));
  console.log("   ", JSON.stringify(d.rows), "|", d.stats);
  note(d.pins === 5, `all 5 pins render (${d.pins})`);
  note(/Seoul=—/.test(d.rows.join(",")) && /Porto=—/.test(d.rows.join(",")), "undated rows show an em dash");
  note(d.rows[d.rows.length-1].startsWith("Porto") || d.rows[d.rows.length-1].startsWith("Seoul"), `undated sort last (${d.rows.join(", ")})`);
  note(d.years.includes("No year"), `"No year" option offered (${d.years.join(", ")})`);
  note(d.stats.startsWith("4 / 5"), `stats count undated places (${d.stats})`);
  note(/year unknown/.test(d.summary), "text summary says year unknown");

  // Filter to "No year"
  await p.selectOption("[data-year]", { label: "No year" });
  await p.waitForTimeout(300);
  let f = await p.evaluate(() => ({
    rows: [...document.querySelectorAll(".pm-row .pm-rowcity")].map(e=>e.textContent),
    dim: document.querySelectorAll(".pm-pin.is-dim").length,
    stats: [...document.querySelectorAll("[data-stat]")].map(e=>e.textContent).join(" / ")
  }));
  console.log("   filtered:", JSON.stringify(f));
  note(f.rows.length === 2 && f.rows.includes("Seoul") && f.rows.includes("Porto"), `"No year" filter isolates the 2 undated (${f.rows.join(", ")})`);
  note(f.dim === 3, `dated pins dim (${f.dim})`);

  // Open an undated place
  await p.click('[data-place="seoul"]');
  await p.waitForTimeout(300);
  const card = await p.evaluate(() => ({
    kicker: document.querySelectorAll(".pm-kicker").length,
    noKicker: !!document.querySelector(".pm-detail.no-kicker"),
    titlePad: getComputedStyle(document.querySelector(".pm-dcity")).paddingRight,
    city: (document.querySelector(".pm-dcity")||{}).textContent
  }));
  console.log("   card:", JSON.stringify(card));
  note(card.kicker === 0, `undated card drops the kicker entirely (${card.kicker} found)`);
  note(card.noKicker, "card is marked no-kicker");
  note(card.titlePad === "28px", `title takes over the close-button clearance (${card.titlePad})`);
  note(card.city === "Seoul", "card opens for an undated place");
  await p.screenshot({ path: H.shot("12-undated.png") });
  note(p.errors.length === 0, "console clean" + (p.errors.length ? ": "+p.errors.slice(0,3).join(" | ") : ""));

  console.log("\nevery place undated");
  const p2 = await H.pageWith(ctx, ALL_UNDATED);
  const d2 = await p2.evaluate(() => ({
    pins: COUNT(),
    stats: [...document.querySelectorAll("[data-stat]")].map(e=>e.textContent).join(" / "),
    years: [...document.querySelectorAll("[data-year] option")].map(o=>o.textContent).join(","),
    rows: document.querySelectorAll(".pm-row").length
  }));
  console.log("   ", JSON.stringify(d2));
  note(d2.pins === 5 && d2.rows === 5, `all undated still render (${d2.pins} pins, ${d2.rows} rows)`);
  note(d2.stats === "4 / 5 / 2%", `stats hold up with every place undated (${d2.stats})`);
  note(d2.years === "All years,No year", `year select offers only All + No year (${d2.years})`);
  note(p2.errors.length === 0, "all-undated console clean" + (p2.errors.length ? ": "+p2.errors.slice(0,3).join(" | ") : ""));

  console.log("\nadding an undated place through the form");
  const p3 = await H.pageWith(ctx, MIXED);
  await p3.click('.pm-hdactions [data-act="add"]');
  await p3.waitForTimeout(250);
  await p3.fill('[data-f="city"]', "Reykjavik");
  await p3.waitForTimeout(300);
  await p3.click(".pm-acb");
  await p3.waitForTimeout(200);
  await p3.click('[data-act="save"]');          // no year entered at all
  await p3.waitForTimeout(400);
  const saved = await p3.evaluate(() => ({
    hint: (document.querySelector("[data-formhint]")||{}).textContent,
    stillForm: !!document.querySelector(".pm-form"),
    pins: COUNT(),
    card: (document.querySelector(".pm-dcity")||{}).textContent,
    kicker: document.querySelectorAll(".pm-kicker").length,
    json: (document.querySelector("[data-act=\"copy\"]") ? "has-copy" : "no-copy")
  }));
  console.log("   ", JSON.stringify(saved));
  note(!saved.stillForm, "saves with no year rather than rejecting");
  note(saved.pins === 6, `pin added (${saved.pins})`);
  note(saved.kicker === 0, `no kicker for the new undated place (${saved.kicker})`);

  // "To" without "From" must still be rejected.
  await p3.click('.pm-hdactions [data-act="add"]');
  await p3.waitForTimeout(250);
  await p3.fill('[data-f="city"]', "Oslo");
  await p3.waitForTimeout(300);
  await p3.click(".pm-acb");
  await p3.waitForTimeout(200);
  await p3.fill('[data-f="to"]', "2020");
  await p3.click('[data-act="save"]');
  await p3.waitForTimeout(300);
  const bad = await p3.evaluate(() => ({
    stillForm: !!document.querySelector(".pm-form"),
    hint: (document.querySelector("[data-formhint]")||{}).textContent
  }));
  console.log("   ", JSON.stringify(bad));
  note(bad.stillForm && /To on its own|Add a From/.test(bad.hint), `a To with no From is rejected ("${bad.hint}")`);
  note(p3.errors.length === 0, "form console clean" + (p3.errors.length ? ": "+p3.errors.slice(0,3).join(" | ") : ""));

  await b.close();
  R.finish();
})().catch(e => { console.error(e); process.exit(1); });
