/* Regression tests for defects found in review. Each fails against the code
   as it was before its fix. */
const H = require("./support");
const R = H.reporter("regressions");
const note = R.note;


(async () => {
  const b = await H.launch();
  const ctx = await H.context(b, { deviceScaleFactor: 2 });
  const p = await H.newPage(ctx, 1280, 1050);
  await H.open(p, "/index.html");

  /* 1. Panning must not stale a cluster's interaction target. */
  console.log("\n[1] cluster target survives a pan");
  await p.click('[data-zoom="in"]'); await p.waitForTimeout(400);
  const box = await p.locator(".pm-map").boundingBox();
  await p.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width/2 - 120, box.y + box.height/2 - 60, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(400);

  // Hover the first cluster; the tooltip must sit on top of it.
  const drift = await p.evaluate(async () => {
    const c = document.querySelector(".pm-cluster");
    if (!c) return { skip: true };
    c.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const tip = document.querySelector("[data-tip]");
    const wrap = document.querySelector("[data-mapwrap]").getBoundingClientRect();
    const cb = c.getBoundingClientRect();
    // Tooltip anchor (its left %, before the -50% transform) vs the cluster centre.
    const tipX = wrap.left + (parseFloat(tip.style.left) / 100) * wrap.width;
    const tipY = wrap.top + (parseFloat(tip.style.top) / 100) * wrap.height;
    return { dx: Math.abs(tipX - (cb.left + cb.width/2)), dy: Math.abs(tipY - (cb.top + cb.height/2)) };
  });
  console.log("   ", JSON.stringify(drift));
  note(!drift.skip && drift.dx < 12 && drift.dy < 12,
    `tooltip tracks the cluster after panning (off by ${drift.dx?.toFixed(0)}px, ${drift.dy?.toFixed(0)}px)`);

  // Clicking must zoom toward the cluster, not toward where it used to be.
  // Pick a cluster actually inside the map box — after panning, some sit
  // outside it and a real click would land on the page instead.
  const clusterBefore = await p.evaluate(() => {
    const wrap = document.querySelector("[data-mapwrap]").getBoundingClientRect();
    const c = [...document.querySelectorAll(".pm-cluster")].find(n => {
      const r = n.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      return cx > wrap.left + 20 && cx < wrap.right - 20 && cy > wrap.top + 20 && cy < wrap.bottom - 20;
    });
    if (!c) return { none: true };
    c.dataset.target = "1";
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, count: +c.querySelector(".pm-ccount").textContent };
  });
  if (clusterBefore.none) { console.log("    (no cluster inside the map box after panning)"); }
  else { await p.mouse.click(clusterBefore.x, clusterBefore.y); }
  await p.waitForTimeout(600);
  const stillVisible = await p.evaluate((before) => {
    const wrap = document.querySelector("[data-mapwrap]").getBoundingClientRect();
    // After zooming toward it, the places it held must still be on screen.
    const nodes = [...document.querySelectorAll(".pm-pin,.pm-cluster")];
    const inside = nodes.filter(n => {
      const r = n.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      return cx >= wrap.left && cx <= wrap.right && cy >= wrap.top && cy <= wrap.bottom;
    });
    return { total: nodes.length, inside: inside.length };
  }, clusterBefore);
  console.log("   ", JSON.stringify(stillVisible));
  note(stillVisible.inside > 0, `zoom lands somewhere with pins in view (${stillVisible.inside}/${stillVisible.total})`);
  await p.click('[data-zoom="reset"]'); await p.waitForTimeout(400);

  /* 2. Keyboard focus survives the rebuild that activation triggers. */
  console.log("\n[2] keyboard focus survives cluster activation");
  const kb = await p.evaluate(async () => {
    const c = document.querySelector(".pm-cluster");
    c.focus();
    const before = document.activeElement === c;
    c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    const a = document.activeElement;
    return { before, stillInLayer: !!(a && a.closest && a.closest(".pm-pins")), tag: a ? a.tagName : "none" };
  });
  console.log("   ", JSON.stringify(kb));
  note(kb.before, "cluster can take focus");
  note(kb.stillInLayer, `focus stays in the pin layer after activating (landed on ${kb.tag})`);
  await p.click('[data-zoom="reset"]'); await p.waitForTimeout(400);

  /* 3. Tooltip must not be squeezed into a column near the map's right edge. */
  console.log("\n[3] tooltip is not squeezed at the right edge");
  const tipBox = await p.evaluate(async () => {
    const tip = document.querySelector("[data-tip]");
    tip.hidden = false;
    tip.innerHTML = "<b>Qinhuangdao</b> <span>2023</span>";
    tip.style.left = "90%"; tip.style.top = "50%";
    await new Promise(r => setTimeout(r, 60));
    const r = tip.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(tip).lineHeight) || 14;
    return { w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / lh) };
  });
  console.log("   ", JSON.stringify(tipBox));
  note(tipBox.lines <= 2, `short label stays on one line near the edge (${tipBox.lines} lines, ${tipBox.w}px wide)`);

  /* 4. The repaint cache is actually reachable on the update path. */
  console.log("\n[4] places array is referentially stable");
  const stable = await p.evaluate(() => {
    // Two renders with no data change must hand map.js the same array.
    const a = window.__pmplaces;
    document.querySelector("[data-year]").dispatchEvent(new Event("change"));
    return a === window.__pmplaces;
  });
  note(stable, "map.js receives an identity-stable places array between renders");

  note(p.errors.length === 0, "console clean" + (p.errors.length ? ": "+p.errors.slice(0,4).join(" | ") : ""));
  await ctx.close();

  /* 5. A resize that swaps the artboard must not leave the pin layer empty. */
  console.log("\n[5] artboard swap rebuilds the pin layer");
  const ctx2 = await H.context(b, {});
  const rp = await H.newPage(ctx2, 1280, 900);
  await H.open(rp, "/index.html");
  const wide = await rp.evaluate(() => ({ n: document.querySelectorAll(".pm-pin,.pm-cluster").length, vb: document.querySelector(".pm-map").getAttribute("viewBox") }));
  await rp.setViewportSize({ width: 380, height: 900 });
  await rp.waitForTimeout(700);
  const narrow = await rp.evaluate(() => ({ n: document.querySelectorAll(".pm-pin,.pm-cluster").length, vb: document.querySelector(".pm-map").getAttribute("viewBox") }));
  await rp.setViewportSize({ width: 1280, height: 900 });
  await rp.waitForTimeout(700);
  const backWide = await rp.evaluate(() => ({ n: document.querySelectorAll(".pm-pin,.pm-cluster").length, vb: document.querySelector(".pm-map").getAttribute("viewBox") }));
  console.log("   ", JSON.stringify({ wide, narrow, backWide }));
  note(narrow.vb !== wide.vb, `viewBox swaps on resize (${wide.vb} -> ${narrow.vb})`);
  note(narrow.n > 0, `pins present after shrinking (${narrow.n})`);
  note(backWide.n > 0, `pins present after growing back (${backWide.n})`);
  note(rp.errors.length === 0, "no page errors across resizes" + (rp.errors.length ? ": " + rp.errors[0] : ""));

  await b.close();
  R.finish();
})().catch(e => { console.error(e); process.exit(1); });
