/* Clustering: grouping, splitting on zoom, activation, selection carve-out,
   filtering, keyboard reach, the tooltip, and the style-tile disc. */
const H = require("./support");
const R = H.reporter("clusters");
const note = R.note;

/* One reading of the pin layer: cluster counts, loose pins, dimmed, selected. */
const snap = () => ({
  clusters: [...document.querySelectorAll(".pm-cluster")].map(c => +c.querySelector(".pm-ccount").textContent),
  pins: document.querySelectorAll(".pm-pin").length,
  dimPins: document.querySelectorAll(".pm-pin.is-dim").length,
  selPins: document.querySelectorAll(".pm-pin.is-sel").length
});


(async () => {
  const places = H.places();
  const b = await H.launch();
  const ctx = await H.context(b, { deviceScaleFactor: 2, colorScheme: "dark" });

  const p = await H.newPage(ctx, 1280, 1050);
  await H.open(p, "/index.html");
  await p.waitForFunction(() => document.querySelectorAll(".pm-pin,.pm-cluster").length > 0, { timeout: 20000 });
  await p.waitForTimeout(600);

  const total = t => t.clusters.reduce((a,b)=>a+b,0) + t.pins;

  console.log("\nzoom 1 (default)");
  const z1 = await p.evaluate(snap);
  console.log("   ", JSON.stringify(z1));
  note(z1.clusters.length > 0, `dense areas cluster (${z1.clusters.length} clusters: ${z1.clusters.join(",")})`);
  note(total(z1) === places.length, `every place accounted for: ${total(z1)}/${places.length}`);
  note(Math.max(...z1.clusters) > 1, "cluster counts are >1");

  // The disc must match the design: r 6.4, accent fill, on-accent 7.5px text.
  const style = await p.evaluate(() => {
    const c = document.querySelector(".pm-cluster");
    const disc = c.querySelector(".pm-cdisc"), txt = c.querySelector(".pm-ccount");
    const cs = getComputedStyle(txt);
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    probe.style.color = "var(--accent)";
    const accent = getComputedStyle(probe).color;
    probe.style.color = "var(--on-accent)";
    const onAccent = getComputedStyle(probe).color;
    probe.remove();
    return { accent, onAccent, r: disc.getAttribute("r"), fill: getComputedStyle(disc).fill,
             size: cs.fontSize, family: cs.fontFamily, colour: cs.fill,
             scaled: c.querySelector(".pm-pinscale").getAttribute("transform") };
  });
  console.log("   ", JSON.stringify(style));
  note(style.r === "6.4", `disc radius 6.4 (${style.r})`);
  note(style.fill === style.accent, `disc fill is --accent (${style.fill} vs token ${style.accent})`);
  note(style.size === "7.5px", `count is 7.5px (${style.size})`);
  note(/Plex Mono/.test(style.family), `count is Plex Mono (${style.family})`);
  note(style.colour === style.onAccent, `count is --on-accent (${style.colour} vs token ${style.onAccent})`);
  await p.screenshot({ path: H.shot("30-cluster-z1.png") });

  console.log("\nzoom in — clusters must split");
  for (let i = 0; i < 3; i++) { await p.click('[data-zoom="in"]'); await p.waitForTimeout(350); }
  const z2 = await p.evaluate(snap);
  console.log("   ", JSON.stringify(z2));
  note(total(z2) === places.length, `every place still accounted for: ${total(z2)}/${places.length}`);
  note(z2.pins > z1.pins, `more individual pins after zooming (${z1.pins} -> ${z2.pins})`);
  note(z2.clusters.length === 0 || Math.max(...z2.clusters) <= Math.max(...z1.clusters),
    `largest cluster shrinks or disappears (${z1.clusters.join(",")} -> ${z2.clusters.join(",") || "none"})`);
  await p.screenshot({ path: H.shot("31-cluster-z4.png") });

  await p.click('[data-zoom="reset"]');
  await p.waitForTimeout(400);

  console.log("\nactivating a cluster zooms in");
  const before = await p.evaluate(() => document.querySelector(".pm-map > g").getAttribute("transform") || "none");
  await p.click(".pm-cluster");
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => document.querySelector(".pm-map > g").getAttribute("transform") || "none");
  const z3 = await p.evaluate(snap);
  console.log("   ", before, "->", after);
  note(before !== after, "clicking a cluster changes the zoom transform");
  note(total(z3) === places.length, `every place accounted for after cluster zoom: ${total(z3)}/${places.length}`);
  await p.click('[data-zoom="reset"]');
  await p.waitForTimeout(400);

  console.log("\nselection is never hidden inside a cluster");
  // Select a place in the densest region (China) from the list.
  await p.evaluate(() => {
    const row = [...document.querySelectorAll(".pm-row")].find(r => /china/i.test(r.querySelector(".pm-rowc").textContent));
    row.click();
  });
  await p.waitForTimeout(400);
  const sel = await p.evaluate(snap);
  const selName = await p.evaluate(() => (document.querySelector(".pm-dcity")||{}).textContent);
  console.log("   selected:", selName, JSON.stringify(sel));
  note(sel.selPins === 1, `selected place renders as its own pin, not folded into a cluster (${sel.selPins})`);
  note(total(sel) === places.length, `every place accounted for with a selection: ${total(sel)}/${places.length}`);

  console.log("\nfiltering: dimmed places never join a cluster");
  await p.selectOption("[data-year]", "2023");
  await p.waitForTimeout(450);
  const filt = await p.evaluate(snap);
  const dimInfo = await p.evaluate(() => {
    // Any place excluded by the filter must be a standalone dim pin.
    const dimmed = document.querySelectorAll(".pm-pin.is-dim").length;
    const clustered = [...document.querySelectorAll(".pm-cluster .pm-ccount")].reduce((a,e)=>a+ +e.textContent,0);
    return { dimmed, clustered, matching: document.querySelectorAll(".pm-row").length };
  });
  console.log("   ", JSON.stringify(filt), JSON.stringify(dimInfo));
  note(total(filt) === places.length, `every place accounted for while filtered: ${total(filt)}/${places.length}`);
  note(dimInfo.dimmed === places.length - dimInfo.matching,
    `all ${places.length - dimInfo.matching} non-matching places are standalone dim pins (${dimInfo.dimmed})`);
  await p.screenshot({ path: H.shot("32-cluster-filtered.png") });
  await p.selectOption("[data-year]", "all");
  await p.waitForTimeout(400);

  console.log("\naccessibility + tooltip");
  const a11y = await p.evaluate(() => {
    const c = document.querySelector(".pm-cluster");
    return { tabindex: c.getAttribute("tabindex"), role: c.getAttribute("role"), label: c.getAttribute("aria-label") };
  });
  console.log("   ", JSON.stringify(a11y));
  note(a11y.tabindex === "0" && a11y.role === "button", "cluster is keyboard reachable as a button");
  note(/places here/.test(a11y.label) && /Activate to zoom in/.test(a11y.label), `cluster label explains itself ("${a11y.label.slice(0,70)}...")`);

  await p.hover(".pm-cluster");
  await p.waitForTimeout(250);
  const tip = await p.evaluate(() => {
    const t = document.querySelector("[data-tip]");
    return { hidden: t.hidden, text: t.textContent, left: t.style.left };
  });
  console.log("   ", JSON.stringify(tip));
  note(!tip.hidden && /places/.test(tip.text), `cluster tooltip shows the count ("${tip.text}")`);

  note(p.errors.length === 0, "console clean" + (p.errors.length ? ": "+p.errors.slice(0,4).join(" | ") : ""));
  await b.close();
  R.finish();
})().catch(e => { console.error(e); process.exit(1); });
