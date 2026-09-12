/* Shared harness for the browser tests.
 *
 * The page is loaded exactly as it ships — including its subresource-integrity
 * attributes — and the three CDN requests are fulfilled from byte-identical
 * npm copies. The integrity hashes only pass because the bytes really are the
 * same, which is itself a check that the pinned versions are what we think.
 *
 * Run `npm run test:setup` once to install the fixtures, then `npm test`.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const NM = path.join(REPO, "node_modules");
const SHOTS = path.join(__dirname, "shots");
const BASE = process.env.BASE || "http://127.0.0.1:8000";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Which world-atlas file js/map.js asks for. Kept in step with WORLD_URL.
const WORLD = "world-atlas/countries-50m.json";

const FONTS = {
  "spectral-300.woff2": "@fontsource/spectral/files/spectral-latin-300-normal.woff2",
  "spectral-400.woff2": "@fontsource/spectral/files/spectral-latin-400-normal.woff2",
  "spectral-500.woff2": "@fontsource/spectral/files/spectral-latin-500-normal.woff2",
  "plex-400.woff2": "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "plex-500.woff2": "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"
};

const FONT_CSS = Object.keys(FONTS).map(function (name) {
  const spectral = name.indexOf("spectral") === 0;
  const weight = name.match(/-(\d+)\./)[1];
  return "@font-face{font-family:'" + (spectral ? "Spectral" : "IBM Plex Mono") +
         "';font-weight:" + weight + ";font-style:normal;font-display:swap;" +
         "src:url(https://fonts.gstatic.com/" + name + ") format('woff2')}";
}).join("\n");

function missingFixtures() {
  const needed = [WORLD, "d3/dist/d3.min.js", "topojson-client/dist/topojson-client.min.js"]
    .concat(Object.keys(FONTS).map(function (k) { return FONTS[k]; }));
  return needed.filter(function (rel) { return !fs.existsSync(path.join(NM, rel)); });
}

/** Fulfil every off-network request from the vendored copies. */
async function installRoutes(ctx, opts) {
  opts = opts || {};

  if (opts.places !== undefined) {
    const body = typeof opts.places === "string" ? opts.places : JSON.stringify(opts.places);
    await ctx.route("**/data/places.json", function (route) {
      route.fulfill({ status: 200, contentType: "application/json", body: body });
    });
  }

  await ctx.route("https://unpkg.com/**", function (route) {
    const file = route.request().url().indexOf("topojson-client") >= 0
      ? "topojson-client/dist/topojson-client.min.js"
      : "d3/dist/d3.min.js";
    route.fulfill({ status: 200, contentType: "application/javascript",
                    body: fs.readFileSync(path.join(NM, file)) });
  });

  await ctx.route("https://cdn.jsdelivr.net/**", function (route) {
    route.fulfill({ status: 200, contentType: "application/json",
                    body: fs.readFileSync(path.join(NM, WORLD)) });
  });

  await ctx.route("https://fonts.googleapis.com/**", function (route) {
    route.fulfill({ status: 200, contentType: "text/css", body: FONT_CSS });
  });

  await ctx.route("https://fonts.gstatic.com/**", function (route) {
    const rel = FONTS[route.request().url().split("/").pop()];
    if (!rel) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ status: 200, contentType: "font/woff2",
                    body: fs.readFileSync(path.join(NM, rel)) });
  });
}

/** A context with the routes already installed, plus a browser-side COUNT(). */
async function context(browser, opts) {
  opts = opts || {};
  const places = opts.places;
  delete opts.places;
  const ctx = await browser.newContext(Object.assign({ colorScheme: "dark" }, opts));
  await installRoutes(ctx, places === undefined ? {} : { places: places });
  // A place is present whether it is its own pin or folded into a cluster.
  await ctx.addInitScript(function () {
    window.COUNT = function () {
      var loose = document.querySelectorAll(".pm-pin").length;
      var clustered = Array.prototype.slice
        .call(document.querySelectorAll(".pm-cluster .pm-ccount"))
        .reduce(function (a, e) { return a + Number(e.textContent); }, 0);
      return loose + clustered;
    };
  });
  return ctx;
}

/** A page serving its own place list, opened and ready. */
async function pageWith(ctx, places, width, height) {
  const page = await newPage(ctx, width || 1280, height || 950);
  await page.route("**/data/places.json", function (route) {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(places) });
  });
  if (places.length) await open(page); else await openEmpty(page);
  return page;
}

/** A page that records everything the console would have shouted about. */
async function newPage(ctx, width, height) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: width, height: height });
  const errors = [];
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", function (e) { errors.push("pageerror: " + e.message); });
  page.on("requestfailed", function (r) {
    errors.push("requestfailed: " + r.url() + " " + ((r.failure() || {}).errorText || ""));
  });
  page.on("response", function (r) {
    if (r.status() >= 400) errors.push("HTTP " + r.status() + " " + r.url());
  });
  page.errors = errors;
  return page;
}

/** Wait until the map has drawn its countries and at least one place marker. */
async function open(page, url) {
  await page.goto(BASE + (url || "/index.html"), { waitUntil: "load" });
  await page.waitForFunction(function () {
    return document.querySelectorAll(".pm-countries path").length > 100 &&
           document.querySelectorAll(".pm-pin,.pm-cluster").length > 0;
  }, { timeout: 25000 });
  await page.waitForTimeout(400);
}

/** Same, for a page expected to have no places at all. */
async function openEmpty(page, url) {
  await page.goto(BASE + (url || "/index.html"), { waitUntil: "load" });
  await page.waitForFunction(function () {
    return document.querySelectorAll(".pm-countries path").length > 100;
  }, { timeout: 25000 });
  await page.waitForTimeout(400);
}

/* A place is present whether it is drawn as its own pin or folded into a
   cluster, so every count goes through this. */
const COUNT_PLACES = function () {
  var loose = document.querySelectorAll(".pm-pin").length;
  var clustered = Array.prototype.slice
    .call(document.querySelectorAll(".pm-cluster .pm-ccount"))
    .reduce(function (a, e) { return a + Number(e.textContent); }, 0);
  return loose + clustered;
};

function reporter(name) {
  const problems = [];
  return {
    note: function (ok, msg) {
      console.log((ok ? "  PASS  " : "  FAIL  ") + msg);
      if (!ok) problems.push(msg);
    },
    finish: function () {
      console.log("\n" + "-".repeat(58));
      if (problems.length) {
        console.log(name + ": " + problems.length + " PROBLEM(S)");
        problems.forEach(function (p) { console.log("  - " + p); });
        process.exit(1);
      }
      console.log(name + ": all checks passed");
    }
  };
}

async function launch() {
  const missing = missingFixtures();
  if (missing.length) {
    console.error("Missing test fixtures:\n  " + missing.join("\n  ") +
                  "\n\nRun:  npm run test:setup\n");
    process.exit(1);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  return chromium.launch({ executablePath: CHROME });
}

module.exports = {
  REPO: REPO, NM: NM, SHOTS: SHOTS, BASE: BASE,
  launch: launch, installRoutes: installRoutes, newPage: newPage,
  context: context, pageWith: pageWith,
  open: open, openEmpty: openEmpty, reporter: reporter,
  COUNT_PLACES: COUNT_PLACES,
  fixture: function (name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
  },
  places: function () {
    return JSON.parse(fs.readFileSync(path.join(REPO, "data/places.json"), "utf8"));
  },
  shot: function (name) { return path.join(SHOTS, name); }
};
