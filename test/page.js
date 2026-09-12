/* The shipped page: layout, the country join, selection, the add flow,
   filters, zoom, both themes, mobile, the empty state and blocked storage.
   Runs against a 44-place fixture, which exercises the join far harder than
   the real data does. */
const H = require("./support");
const R = H.reporter("page");
const note = R.note;
const FIXTURE = H.fixture("sample44.json");








(async () => {
  const browser = await H.launch();
  // Dark OS preference: the page should follow it with no ?theme and no saved
  // toggle. The light branch is checked separately below.
  const ctx = await H.context(browser, { deviceScaleFactor: 2, colorScheme: "dark", places: FIXTURE });

  const expected = FIXTURE;
  const expectedIso3 = [...new Set(expected.map(p => p.iso3))].sort();

  /* ---------- desktop, dark ---------- */
  console.log("\n1280px · dark");
  let page = await H.newPage(ctx, 1280, 1000);
  await H.open(page, "/index.html");
  

  const d = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    countries: document.querySelectorAll(".pm-countries path").length,
    pins: COUNT(),
    tinted: [...document.querySelectorAll(".pm-countries path")].filter(p => /is-v[123]/.test(p.getAttribute("class"))).length,
    stats: [...document.querySelectorAll("[data-stat]")].map(e => e.getAttribute("data-stat") + "=" + e.textContent),
    listRows: document.querySelectorAll(".pm-row").length,
    listCount: document.querySelector("[data-listcount]").textContent,
    viewBox: document.querySelector(".pm-map").getAttribute("viewBox"),
    appWidth: document.querySelector(".pm-app").getBoundingClientRect().width,
    legend: document.querySelectorAll(".pm-leg").length,
    summary: (document.querySelector("[data-summary]").textContent || "").slice(0, 60),
    font: getComputedStyle(document.querySelector(".pm-title")).fontFamily,
    docScrollW: document.documentElement.scrollWidth
  }));
  console.log("   ", JSON.stringify(d, null, 0).slice(0, 400));

  note(d.theme === "dark", "follows a dark OS preference");
  note(d.countries > 170, `country paths drawn (${d.countries})`);
  note(d.pins === expected.length, `pin per place (${d.pins}/${expected.length})`);
  note(d.listRows === expected.length, `list row per place (${d.listRows})`);
  note(d.viewBox === "0 0 688 358", `desktop viewBox (${d.viewBox})`);
  note(Math.round(d.appWidth) === 1060, `max-width 1060 honoured (${Math.round(d.appWidth)})`);
  note(d.legend === 3, `legend has 3 keys (${d.legend})`);
  note(/Spectral/.test(d.font), `title uses Spectral (${d.font})`);
  note(d.docScrollW <= 1280, `no horizontal scroll (${d.docScrollW})`);

  await page.screenshot({ path: H.shot("01-desktop-dark.png"), fullPage: true });

  /* ---------- the country join, country by country ----------
     Natural Earth 110m has no polygon for a handful of very small countries.
     Singapore is the only one the seed data hits. Every OTHER country in
     places.json must light up, and the step must match the visit count. */
  console.log("\ncountry join");
  // At 50m every country in the fixture has a polygon; 110m dropped Singapore.
  const NO_POLYGON = [];
  const join = await page.evaluate(() => {
    const m = window.__pmmap;
    const counts = {};
    window.__pmplaces.forEach(p => { counts[p.iso3] = (counts[p.iso3] || 0) + 1; });
    const out = {};
    Object.keys(counts).forEach(iso3 => {
      out[iso3] = { visits: counts[iso3], drawable: m.hasCountry(iso3), step: m.stepOf(iso3) };
    });
    return out;
  });

  const notLit = Object.keys(join).filter(c => join[c].drawable && join[c].step === 0);
  const noPoly = Object.keys(join).filter(c => !join[c].drawable);
  note(notLit.length === 0, `every drawable country lights up${notLit.length ? " — dark: " + notLit.join(", ") : ` (${expectedIso3.length - noPoly.length}/${expectedIso3.length})`}`);
  note(
    noPoly.length === NO_POLYGON.length && noPoly.every(c => NO_POLYGON.includes(c)),
    `every country in the fixture has a polygon (${noPoly.join(", ") || "none missing"})`
  );

  const wrongStep = Object.keys(join).filter(c => {
    if (!join[c].drawable) return false;
    const want = join[c].visits >= 3 ? 3 : join[c].visits === 2 ? 2 : 1;
    return join[c].step !== want;
  });
  note(wrongStep.length === 0, `fill step matches visit count${wrongStep.length ? " — wrong: " + wrongStep.join(", ") : ""}`);
  const steps = {};
  Object.keys(join).forEach(c => { if (join[c].step) steps[join[c].step] = (steps[join[c].step] || 0) + 1; });
  console.log("    steps in use:", JSON.stringify(steps));

  /* ---------- selection ---------- */
  console.log("\nselection");
  await page.click(".pm-row");
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => ({
    card: !!document.querySelector(".pm-detail"),
    city: (document.querySelector(".pm-dcity") || {}).textContent,
    kicker: (document.querySelector(".pm-kicker") || {}).textContent,
    ringed: document.querySelectorAll(".pm-pin.is-sel").length,
    rowSel: document.querySelectorAll(".pm-row.is-sel").length
  }));
  console.log("   ", JSON.stringify(sel));
  note(sel.card, "detail card opens");
  note(sel.ringed === 1, `exactly one pin ringed (${sel.ringed})`);
  note(sel.rowSel === 1, `exactly one row highlighted (${sel.rowSel})`);
  await page.screenshot({ path: H.shot("02-desktop-selected.png"), fullPage: true });

  /* ---------- add panel ---------- */
  console.log("\nadd panel");
  await page.click('[data-act="close"]');
  await page.click('.pm-hdactions [data-act="add"]');
  await page.waitForTimeout(200);
  // Typed WITHOUT the accent, to prove the search folds diacritics.
  await page.fill('[data-f="city"]', "Valparaiso");
  await page.waitForTimeout(300);
  const ac = await page.evaluate(() => ({
    open: !document.querySelector("[data-ac]").hidden,
    hits: [...document.querySelectorAll(".pm-acb span")].map(e => e.textContent),
    adding: document.querySelector(".pm-map").classList.contains("is-adding")
  }));
  console.log("   ", JSON.stringify(ac));
  note(ac.open, "typeahead opens");
  note(ac.hits.includes("Valparaíso"), `accent-folded search finds Valparaíso (${ac.hits.join(", ")})`);
  note(ac.adding, "map goes into pin-drop mode");
  await page.screenshot({ path: H.shot("03-desktop-add.png"), fullPage: true });

  // Pick a city, fill a year, save — then the draft banner should appear.
  await page.click('.pm-acb:has-text("Valparaíso")');
  await page.waitForTimeout(200);
  await page.fill('[data-f="from"]', "2025");
  await page.click('[data-act="save"]');
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => ({
    draft: !!document.querySelector(".pm-draft"),
    banner: (document.querySelector(".pm-draftl") || {}).textContent,
    pins: COUNT(),
    card: (document.querySelector(".pm-dcity") || {}).textContent
  }));
  console.log("   ", JSON.stringify(saved).slice(0, 260));
  note(saved.draft, "draft banner appears after save");
  note(saved.pins === expected.length + 1, `new pin rendered (${saved.pins})`);
  await page.screenshot({ path: H.shot("04-desktop-draft.png"), fullPage: true });

  /* ---------- filters ----------
     Year is the only filter now; the lived/visited/passed control is gone. */
  console.log("\nfilters");
  const gone = await page.evaluate(() => ({
    typeControl: document.querySelectorAll("[data-type], .pm-seg, .pm-segb").length,
    legendKeys: [...document.querySelectorAll(".pm-leg")].map(e => e.textContent.trim()),
    rowTypes: document.querySelectorAll(".pm-rowtype").length,
    pinVariants: document.querySelectorAll(".pm-pin-lived, .pm-pin-passed").length,
    sub: document.querySelector("[data-sub]").textContent
  }));
  console.log("   ", JSON.stringify(gone));
  note(gone.typeControl === 0, `type filter control is gone (${gone.typeControl} nodes)`);
  note(gone.rowTypes === 0, `no type label in list rows (${gone.rowTypes})`);
  note(gone.pinVariants === 0, `no lived/passed pin variants (${gone.pinVariants})`);
  note(gone.legendKeys.length === 3 && !/lived|passed/i.test(gone.legendKeys.join(" ")),
    `legend has 3 keys, none lived/passed (${gone.legendKeys.join(" | ")})`);
  note(!/lived|passed/i.test(gone.sub), `sub-heading drops lived/passed ("${gone.sub}")`);

  const years = await page.evaluate(() => [...document.querySelectorAll("[data-year] option")].map(o => o.value));
  await page.selectOption("[data-year]", years[1]);
  await page.waitForTimeout(300);
  const filt = await page.evaluate(() => ({
    rows: document.querySelectorAll(".pm-row").length,
    dimmed: document.querySelectorAll(".pm-pin.is-dim").length,
    pins: COUNT()
  }));
  console.log("   ", JSON.stringify(filt));
  note(filt.dimmed > 0, `year filter dims rather than removes (${filt.dimmed} dimmed of ${filt.pins})`);
  note(filt.rows < filt.pins, `list narrows to ${filt.rows}`);
  await page.selectOption("[data-year]", "all");
  await page.waitForTimeout(200);

  /* ---------- zoom ---------- */
  console.log("\nzoom");
  const before = await page.evaluate(() => document.querySelector(".pm-pinscale").getAttribute("transform"));
  await page.click('[data-zoom="in"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    scale: document.querySelector(".pm-pinscale").getAttribute("transform"),
    root: document.querySelector(".pm-map > g").getAttribute("transform")
  }));
  console.log("   before", before, "after", JSON.stringify(after));
  note(before !== after.scale, "pins counter-scale so they keep their size");
  note(/scale\(/.test(after.root || ""), "zoom transform applied to the map");
  await page.click('[data-zoom="reset"]');
  await page.waitForTimeout(300);

  note(page.errors.length === 0, "console clean" + (page.errors.length ? ": " + page.errors.slice(0, 4).join(" | ") : ""));

  /* ---------- light theme ---------- */
  console.log("\n1280px · light");
  const lp = await H.newPage(ctx, 1280, 1000);
  await H.open(lp, "/index.html?theme=light");
  
  const lt = await lp.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    paper: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.querySelector(".pm-title")).color,
    toggle: (document.querySelector('[data-act="theme"]') || {}).textContent
  }));
  console.log("   ", JSON.stringify(lt));
  note(lt.theme === "light", "?theme=light pins the light palette");
  note(lt.paper === "rgb(241, 235, 223)", `light paper is #f1ebdf (${lt.paper})`);
  note(lt.ink === "rgb(34, 29, 22)", `light ink is #221d16 (${lt.ink})`);
  note(lt.toggle === "☀", `toggle shows the light glyph (${lt.toggle})`);
  await lp.screenshot({ path: H.shot("05-desktop-light.png"), fullPage: true });
  note(lp.errors.length === 0, "light console clean" + (lp.errors.length ? ": " + lp.errors.slice(0, 3).join(" | ") : ""));

  /* ---------- theme: OS preference and a toggle that persists ---------- */
  console.log("\ntheme rules");
  const lightCtx = await H.context(browser, { colorScheme: "light", places: FIXTURE });
  const tp = await H.newPage(lightCtx, 1280, 900);
  await H.open(tp, "/index.html");
  
  note(
    await tp.evaluate(() => document.documentElement.getAttribute("data-theme")) === "light",
    "follows a light OS preference when nothing is pinned"
  );
  // Toggle to dark, reload, and it should still be dark.
  await tp.click('[data-act="theme"]');
  await tp.waitForTimeout(150);
  const toggled = await tp.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await tp.reload({ waitUntil: "load" });
  
  const afterReload = await tp.evaluate(() => document.documentElement.getAttribute("data-theme"));
  note(toggled === "dark", `toggle flips to dark (${toggled})`);
  note(afterReload === "dark", `toggle survives a reload (${afterReload})`);
  note(tp.errors.length === 0, "theme console clean" + (tp.errors.length ? ": " + tp.errors.slice(0, 3).join(" | ") : ""));
  await lightCtx.close();

  /* ---------- mobile ---------- */
  console.log("\n390px · dark");
  const mp = await H.newPage(ctx, 390, 900);
  await H.open(mp, "/index.html");
  
  const m = await mp.evaluate(() => ({
    viewBox: document.querySelector(".pm-map").getAttribute("viewBox"),
    cols: getComputedStyle(document.querySelector(".pm-stats")).gridTemplateColumns.split(" ").length,
    mainCols: getComputedStyle(document.querySelector(".pm-main")).gridTemplateColumns.split(" ").length,
    title: getComputedStyle(document.querySelector(".pm-title")).fontSize,
    listMax: getComputedStyle(document.querySelector(".pm-list")).maxHeight,
    pad: getComputedStyle(document.querySelector(".pm-app")).padding,
    scrollW: document.documentElement.scrollWidth
  }));
  console.log("   ", JSON.stringify(m));
  note(m.viewBox === "0 0 334 178", `mobile viewBox (${m.viewBox})`);
  note(m.cols === 2, `stat strip is 2 columns (${m.cols})`);
  note(m.mainCols === 1, `map/list stacked (${m.mainCols})`);
  note(m.title === "23px", `title 23px (${m.title})`);
  note(m.listMax === "250px", `list max-height 250px (${m.listMax})`);
  note(m.scrollW <= 390, `no horizontal scroll at 390 (${m.scrollW})`);
  await mp.screenshot({ path: H.shot("06-mobile-dark.png"), fullPage: true });
  note(mp.errors.length === 0, "mobile console clean" + (mp.errors.length ? ": " + mp.errors.slice(0, 3).join(" | ") : ""));

  /* ---------- 320px floor ---------- */
  const np = await H.newPage(ctx, 320, 800);
  await H.open(np, "/index.html");
  
  const nw = await np.evaluate(() => document.documentElement.scrollWidth);
  note(nw <= 320, `no horizontal scroll at 320 (${nw})`);
  await np.screenshot({ path: H.shot("07-320.png"), fullPage: true });

  /* ---------- empty state ----------
     Its own context: the earlier page saved a draft place to localStorage, and
     a draft is deliberately enough to take the page out of the empty state. */
  console.log("\nempty state");
  const emptyCtx = await H.context(browser, { colorScheme: "dark", places: [] });
  const ep = await H.newPage(emptyCtx, 1280, 900);
  await H.openEmpty(ep, "/index.html");
  await ep.waitForFunction(() => document.querySelectorAll(".pm-countries path").length > 100, { timeout: 20000 });
  await ep.waitForTimeout(400);
  const em = await ep.evaluate(() => ({
    card: !!document.querySelector(".pm-empty"),
    heading: (document.querySelector(".pm-emptyh") || {}).textContent,
    note: (document.querySelector(".pm-mapnote") || {}).textContent,
    sub: document.querySelector("[data-sub]").textContent,
    stats: [...document.querySelectorAll("[data-stat]")].map(e => e.textContent).join(""),
    tinted: [...document.querySelectorAll(".pm-countries path")].filter(p => /is-v/.test(p.getAttribute("class"))).length
  }));
  console.log("   ", JSON.stringify(em));
  note(em.card, "empty card shown");
  note(em.heading === "No places yet", "empty heading");
  note(/countries tint in/.test(em.note || ""), "map overlay note");
  note(em.sub === "A map that fills in as you go.", "sub-heading swaps");
  note(em.stats === "———", `stats render as em dashes (${em.stats})`);
  note(em.tinted === 0, `nothing tinted (${em.tinted})`);
  await ep.screenshot({ path: H.shot("08-empty.png"), fullPage: true });
  note(ep.errors.length === 0, "empty console clean" + (ep.errors.length ? ": " + ep.errors.slice(0, 3).join(" | ") : ""));

  /* ---------- storage blocked ---------- */
  console.log("\nstorage blocked");
  const sp = await H.newPage(ctx, 1280, 900);
  await sp.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("blocked", "SecurityError"); }
    });
  });
  await H.open(sp, "/index.html");
  
  const sb = await sp.evaluate(() => ({
    pins: COUNT(),
    rows: document.querySelectorAll(".pm-row").length
  }));
  console.log("   ", JSON.stringify(sb));
  note(sb.pins === expected.length, `page still works read-only with storage blocked (${sb.pins} pins)`);
  note(sp.errors.length === 0, "storage-blocked console clean" + (sp.errors.length ? ": " + sp.errors.slice(0, 3).join(" | ") : ""));

  await browser.close();
  R.finish();
})().catch(e => { console.error(e); process.exit(1); });
