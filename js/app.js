/* App: state, filtering, the side column, and the draft/commit flow.
 *
 * There is no server — this is a static page — so newly added places live in
 * localStorage as a working draft until you paste them into data/places.json
 * and commit. data/places.json is always the source of truth: when an id turns
 * up in both, the committed file wins and the draft entry is dropped.
 *
 * localStorage is wrapped everywhere: some browsers block storage for
 * third-party iframes, and the page has to keep working read-only when it does.
 */
(function () {
  "use strict";

  var DRAFT_KEY = "pm-draft-places";
  var THEME_KEY = "pm-theme";
  var COUNTRY_TOTAL = 195;

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var app = $("#app");
  var els = {
    sub: $("[data-sub]"),
    stats: $("[data-stats]"),
    year: $("[data-year]"),
    mapwrap: $("[data-mapwrap]"),
    tip: $("[data-tip]"),
    card: $("[data-card]"),
    draft: $("[data-draft]"),
    listcount: $("[data-listcount]"),
    list: $("[data-list]"),
    summary: $("[data-summary]")
  };

  var state = {
    mode: "default",       // default | add | empty
    selectedId: null,
    year: "all"
  };

  var committed = [];      // from data/places.json
  var draft = [];          // from localStorage, not yet committed
  var cities = [];         // typeahead source
  var storageOK = true;
  var map = null;
  var form = null;         // in-progress "add" values, survives re-renders

  /* ---------- storage ---------- */

  function readStore(key) {
    try { return localStorage.getItem(key); }
    catch (e) { storageOK = false; return null; }
  }
  function writeStore(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) { storageOK = false; return false; }
  }

  function loadDraft() {
    var raw = readStore(DRAFT_KEY);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // Every mutation of `draft` funnels through here, so this is the one place
  // the memoised places array needs invalidating for the draft side.
  function saveDraft() {
    placesChanged();
    writeStore(DRAFT_KEY, JSON.stringify(draft));
  }

  /* ---------- data ---------- */

  /* Memoised so the array is referentially stable between changes. js/map.js
     compares by identity to decide whether the pin layer needs a full rebuild;
     handing it a fresh concat on every render made that check always true and
     the cache behind it useless. Call placesChanged() after touching either
     `committed` or `draft`. */
  var placesCache = null;
  function places() {
    if (!placesCache) placesCache = committed.concat(draft);
    return placesCache;
  }
  function placesChanged() { placesCache = null; }

  function filtered() {
    return places().filter(matches);
  }

  // Sentinel for the "no year" filter. Safe against collision because a real
  // year is always four digits, and unlike a control character it survives
  // being written into an HTML attribute.
  var NO_YEAR = "none";

  function matches(p) {
    return state.year === "all"
      || (state.year === NO_YEAR ? undated(p) : p.from === state.year);
  }

  function visitCounts(list) {
    var v = {};
    list.forEach(function (p) { if (p.iso3) v[p.iso3] = (v[p.iso3] || 0) + 1; });
    return v;
  }

  function stats(list) {
    var countries = {};
    list.forEach(function (p) { if (p.iso3) countries[p.iso3] = 1; });
    var n = Object.keys(countries).length;
    return { countries: n, cities: list.length, pct: Math.round((n / COUNTRY_TOTAL) * 100) };
  }

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* A place can have no year at all — "I know I went, I can't remember when".
     `from` is "" in that case, and every label built from it has to cope. */
  function undated(p) { return !p.from; }

  function dates(p) {
    if (undated(p)) return "";
    return p.to ? p.from + " – " + p.to : p.from;
  }

  /* The kicker is just the year now. With no year there is nothing to put in
     it, so the card drops it and the title takes over the padding that keeps
     text clear of the close button. */

  // Undated places sort to the bottom of the list rather than to 1970.
  function byYearDesc(a, b) {
    if (undated(a) !== undated(b)) return undated(a) ? 1 : -1;
    return b.from.localeCompare(a.from) || a.city.localeCompare(b.city);
  }

  function byId(id) {
    var all = places();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function slug(s) {
    return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // Most of the bundled city names carry diacritics ("Valparaíso", "Abū
  // Ghurayb"), so search has to compare against a folded form or typing the
  // plain-ASCII spelling finds nothing.
  function fold(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[‘’ʻʼ']/g, "");
  }

  /* ---------- render ---------- */

  function render() {
    var list = filtered();
    var empty = places().length === 0;
    state.mode = empty && state.mode !== "add" ? "empty" : (state.mode === "empty" ? "default" : state.mode);

    els.sub.textContent = empty
      ? "A map that fills in as you go."
      : "A slow record of the cities I've been to.";

    renderStats(list, empty);
    renderYears();
    renderCard();
    renderDraft();
    renderList(list, empty);
    renderSummary(list, empty);
    renderMapNote(empty);

    if (map) {
      map.update({
        visits: visitCounts(list),
        places: places(),
        selectedId: state.selectedId,
        isDim: function (p) { return !matches(p); }
      });
      map.setAdding(state.mode === "add");
    }
  }

  function renderStats(list, empty) {
    var s = stats(list);
    var vals = { countries: s.countries, cities: s.cities, pct: s.pct + "%" };
    $$("[data-stat]", els.stats).forEach(function (el) {
      el.textContent = empty ? "—" : vals[el.getAttribute("data-stat")];
    });
  }

  function renderYears() {
    var years = {};
    var anyUndated = false;
    places().forEach(function (p) {
      if (undated(p)) anyUndated = true; else years[p.from] = 1;
    });
    var sorted = Object.keys(years).sort().reverse();
    var want = "all|" + sorted.join("|") + (anyUndated ? "|none" : "");
    if (els.year.getAttribute("data-built") === want) {
      els.year.value = state.year;
      return;
    }
    els.year.setAttribute("data-built", want);
    els.year.innerHTML = '<option value="all">All years</option>' +
      sorted.map(function (y) { return '<option value="' + esc(y) + '">' + esc(y) + "</option>"; }).join("") +
      // Only offered when something is actually undated, so the control does
      // not advertise a filter that would always come back empty.
      (anyUndated ? '<option value="' + esc(NO_YEAR) + '">No year</option>' : "");
    els.year.value = state.year;
  }

  function renderMapNote(empty) {
    var note = $(".pm-mapnote", els.mapwrap);
    if (empty && !note) {
      note = document.createElement("div");
      note.className = "pm-mapnote";
      note.textContent = "countries tint in as you add places";
      els.mapwrap.appendChild(note);
    } else if (!empty && note) {
      note.remove();
    }
  }

  function renderList(list, empty) {
    if (empty) {
      els.listcount.textContent = "0 places";
      els.list.innerHTML = "";
      return;
    }
    els.listcount.textContent = list.length + " place" + (list.length === 1 ? "" : "s");

    if (!list.length) {
      els.list.innerHTML = '<p class="pm-listempty">Nothing matches this filter.</p>';
      return;
    }

    var sorted = list.slice().sort(byYearDesc);

    els.list.innerHTML = sorted.map(function (p) {
      var said = p.city + ", " + p.country +
                 (undated(p) ? ", year unknown" : ", " + dates(p));
      return '<button class="pm-row' + (p.id === state.selectedId ? " is-sel" : "") + '"' +
             ' type="button" data-place="' + esc(p.id) + '"' +
             ' aria-label="' + esc(said) + '">' +
               '<span class="pm-dot"></span>' +
               '<span class="pm-rowmain">' +
                 '<span class="pm-rowcity">' + esc(p.city) + "</span>" +
                 '<span class="pm-rowc">' + esc(p.country) + "</span>" +
               "</span>" +
               // An em dash keeps the column aligned for undated places.
               '<span class="pm-rowyear">' + (undated(p) ? "—" : esc(p.from)) + "</span>" +
             "</button>";
    }).join("");
  }

  function renderSummary(list, empty) {
    if (empty) { els.summary.textContent = "No places recorded yet."; return; }
    var s = stats(list);
    els.summary.textContent =
      "Map of " + s.cities + " place" + (s.cities === 1 ? "" : "s") +
      " in " + s.countries + " countr" + (s.countries === 1 ? "y" : "ies") + ". " +
      list.slice().sort(byYearDesc)
        .map(function (p) {
          return p.city + ", " + p.country +
                 (undated(p) ? " — year unknown." : " — " + dates(p) + ".");
        }).join(" ");
  }

  /* ---------- the card: detail, form, or empty state ---------- */

  function renderCard() {
    if (state.mode === "add") { els.card.innerHTML = addForm(); bindForm(); return; }

    var sel = state.selectedId && byId(state.selectedId);
    if (sel) { els.card.innerHTML = detailCard(sel); return; }

    if (places().length === 0) { els.card.innerHTML = emptyCard(); return; }

    els.card.innerHTML = "";
  }

  function detailCard(p) {
    return '<div class="pm-detail' + (undated(p) ? " no-kicker" : "") + '">' +
      '<button class="pm-x" type="button" data-act="close" aria-label="Close">×</button>' +
      (undated(p) ? "" : '<div class="pm-kicker">' + esc(dates(p)) + "</div>") +
      '<h3 class="pm-dcity">' + esc(p.city) + "</h3>" +
      '<div class="pm-dcountry">' + esc(p.country) + "</div>" +
      (p.note ? '<p class="pm-note">' + esc(p.note) + "</p>" : "") +
    "</div>";
  }

  function emptyCard() {
    return '<div class="pm-empty">' +
      '<div class="pm-emptymark" aria-hidden="true">◍</div>' +
      '<h3 class="pm-emptyh">No places yet</h3>' +
      '<p class="pm-emptyp">Add somewhere you\'ve been and the country fills in behind it. ' +
      'Pins, stats and years build themselves from the list.</p>' +
      '<button class="pm-btn pm-btn-primary" type="button" data-act="add">Add your first place</button>' +
      '<p class="pm-emptyhint">Or click the map to drop a pin.</p>' +
    "</div>";
  }

  function addForm() {
    var f = form;
    var located = f.lat != null
      ? "Location set · " + f.lat.toFixed(2) + ", " + f.lon.toFixed(2) + (f.iso3 ? " · " + f.iso3 : "")
      : "Pick a city from the list, or click the map, to set the location.";

    return '<div class="pm-detail pm-form">' +
      '<button class="pm-x" type="button" data-act="close" aria-label="Close">×</button>' +
      '<div class="pm-kicker">New entry</div>' +
      '<h3 class="pm-dcity">Add a place</h3>' +
      '<div class="pm-fields">' +
        '<label class="pm-field pm-wide"><span>Place</span>' +
          '<input type="text" data-f="city" autocomplete="off" placeholder="Valparaíso" value="' + esc(f.city) + '">' +
          '<div class="pm-ac" data-ac hidden></div>' +
        "</label>" +
        '<label class="pm-field pm-wide"><span>Country</span>' +
          '<input type="text" data-f="country" autocomplete="off" placeholder="Chile" value="' + esc(f.country) + '">' +
        "</label>" +
        '<label class="pm-field"><span>From</span>' +
          '<input type="text" data-f="from" inputmode="numeric" placeholder="2025 or blank" value="' + esc(f.from) + '">' +
        "</label>" +
        '<label class="pm-field"><span>To</span>' +
          '<input type="text" data-f="to" inputmode="numeric" placeholder="optional" value="' + esc(f.to) + '">' +
        "</label>" +
        '<label class="pm-field pm-wide"><span>Note</span>' +
          '<textarea data-f="note" rows="3" placeholder="One or two lines you\'ll want to reread.">' + esc(f.note) + "</textarea>" +
        "</label>" +
      "</div>" +
      '<div class="pm-formactions">' +
        '<button class="pm-btn pm-btn-primary" type="button" data-act="save">Save place</button>' +
        '<button class="pm-btn" type="button" data-act="close">Cancel</button>' +
      "</div>" +
      '<p class="pm-hint' + (f.error ? " pm-err" : "") + '" data-formhint>' +
        esc(f.error || located) +
      "</p>" +
    "</div>";
  }

  function blankForm() {
    return { city: "", country: "", from: "", to: "", note: "",
             lat: null, lon: null, iso3: null, error: "" };
  }

  /* ---------- draft banner ---------- */

  function renderDraft() {
    if (!draft.length) {
      els.draft.innerHTML = storageOK ? "" :
        '<div class="pm-draft"><p class="pm-draftl">' +
        'Storage is blocked here, so new places last only until you reload. ' +
        'Copy them out before you leave.</p></div>';
      return;
    }
    els.draft.innerHTML =
      '<div class="pm-draft">' +
        '<p class="pm-draftl"><b>' + draft.length + " unsaved place" + (draft.length === 1 ? "" : "s") + "</b>" +
        (storageOK ? " held in this browser." : " — storage is blocked, these are lost on reload.") +
        " Copy the file and paste it into <b>data/places.json</b>, then commit." +
        "</p>" +
        '<div class="pm-draftactions">' +
          '<button class="pm-btn" type="button" data-act="copy">Copy updated places.json</button>' +
          '<button class="pm-btn" type="button" data-act="discard">Discard</button>' +
        "</div>" +
      "</div>";
  }

  function mergedJSON() {
    var all = places().map(function (p) {
      return { id: p.id, city: p.city, country: p.country, iso3: p.iso3,
               lat: p.lat, lon: p.lon, from: p.from, to: p.to, note: p.note };
    });
    return "[\n" + all.map(function (p) { return "  " + JSON.stringify(p); }).join(",\n") + "\n]\n";
  }

  function copyJSON(btn) {
    var text = mergedJSON();
    var done = function (ok) {
      btn.textContent = ok ? "Copied ✓" : "Press ⌘/Ctrl+C";
      setTimeout(function () { btn.textContent = "Copy updated places.json"; }, 2200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  // Clipboard API needs a secure context and is often blocked in iframes;
  // fall back to selecting the text so ⌘/Ctrl+C still works.
  function fallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    done(ok);
  }

  /* ---------- typeahead ---------- */

  function bindForm() {
    var root = els.card;
    $$("[data-f]", root).forEach(function (input) {
      input.addEventListener("input", function () {
        form[input.getAttribute("data-f")] = input.value;
        if (input.getAttribute("data-f") === "city") suggest(input);
      });
    });

    var city = $('[data-f="city"]', root);
    if (city) {
      city.addEventListener("keydown", onAcKey);
      city.addEventListener("blur", function () {
        // Let a click on a suggestion land before the list closes.
        setTimeout(function () { var ac = $("[data-ac]", root); if (ac) ac.hidden = true; }, 120);
      });
    }
  }

  function suggest(input) {
    var ac = $("[data-ac]", els.card);
    if (!ac) return;
    var q = fold(input.value.trim());
    if (q.length < 2) { ac.hidden = true; ac.innerHTML = ""; return; }

    // Names that start with what was typed rank above names that merely
    // contain it, so "york" still offers York before New York.
    var starts = [], contains = [];
    for (var i = 0; i < cities.length; i++) {
      var at = cities[i].k.indexOf(q);
      if (at === 0) starts.push(cities[i]);
      else if (at > 0 && contains.length < 8) contains.push(cities[i]);
      if (starts.length >= 8) break;
    }
    var hits = starts.concat(contains).slice(0, 8);

    if (!hits.length) { ac.hidden = true; ac.innerHTML = ""; return; }
    ac.innerHTML = hits.map(function (c, i) {
      return '<button class="pm-acb' + (i === 0 ? " is-on" : "") + '" type="button"' +
             ' data-city="' + esc(c.n) + '" data-iso3="' + esc(c.c) + '"' +
             ' data-lon="' + c.p[0] + '" data-lat="' + c.p[1] + '">' +
             "<span>" + esc(c.n) + "</span><em>" + esc(map ? (map.countryName(c.c) || c.c) : c.c) + "</em></button>";
    }).join("");
    ac.hidden = false;
  }

  function onAcKey(e) {
    var ac = $("[data-ac]", els.card);
    if (!ac || ac.hidden) return;
    var items = $$(".pm-acb", ac);
    var i = items.findIndex(function (b) { return b.classList.contains("is-on"); });
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (i >= 0) items[i].classList.remove("is-on");
      i = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].classList.add("is-on");
      items[i].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && i >= 0) {
      e.preventDefault();
      pickCity(items[i]);
    } else if (e.key === "Escape") {
      ac.hidden = true;
    }
  }

  function pickCity(btn) {
    form.city = btn.getAttribute("data-city");
    form.iso3 = btn.getAttribute("data-iso3");
    form.lat = +btn.getAttribute("data-lat");
    form.lon = +btn.getAttribute("data-lon");
    form.country = (map && map.countryName(form.iso3)) || form.country;
    form.error = "";
    renderCard();
    var el = $('[data-f="from"]', els.card);
    if (el) el.focus();
  }

  /* ---------- save ---------- */

  function savePlace() {
    var f = form;
    f.city = (f.city || "").trim();
    f.country = (f.country || "").trim();
    f.from = (f.from || "").trim();
    f.to = (f.to || "").trim();

    if (!f.city) return failForm("Give the place a name.");
    // From is optional: you can know you went somewhere without knowing when.
    if (f.from && !/^\d{4}$/.test(f.from)) return failForm("From needs a four-digit year, or leave it empty.");
    if (f.to && !/^\d{4}$/.test(f.to)) return failForm("To needs a four-digit year, or leave it empty.");
    if (f.to && !f.from) return failForm("Add a From year, or clear To — a To on its own has nothing to run from.");
    if (f.to && +f.to < +f.from) return failForm("To is earlier than From.");
    if (f.lat == null || f.lon == null) return failForm("Click the map, or pick a city from the list, to set the location.");

    var id = f.from ? slug(f.city) + "-" + f.from : slug(f.city);
    if (byId(id)) {
      return failForm(f.from
        ? "There is already an entry for " + f.city + " in " + f.from + "."
        : "There is already an undated entry for " + f.city + ".");
    }

    draft.push({
      id: id,
      city: f.city,
      country: f.country || (map && map.countryName(f.iso3)) || "",
      iso3: f.iso3 || null,
      lat: +f.lat.toFixed(4),
      lon: +f.lon.toFixed(4),
      from: f.from,
      to: f.to,
      note: (f.note || "").trim()
    });
    saveDraft();

    form = blankForm();
    state.mode = "default";
    state.selectedId = id;
    render();
  }

  function failForm(msg) {
    form.error = msg;
    renderCard();
    var hint = $("[data-formhint]", els.card);
    if (hint) hint.setAttribute("role", "alert");
  }

  /* ---------- theme ---------- */

  function currentTheme() { return document.documentElement.getAttribute("data-theme"); }

  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    writeStore(THEME_KEY, t);
    syncThemeButton();
  }

  function syncThemeButton() {
    var b = $('[data-act="theme"]');
    if (!b) return;
    var dark = currentTheme() === "dark";
    b.textContent = dark ? "☾" : "☀";
    b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  /* ---------- events ---------- */

  function select(id) {
    state.selectedId = id;
    state.mode = "default";
    render();
    var row = $('[data-place="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]', els.list);
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  app.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act], [data-place], [data-zoom], .pm-acb");
    if (!t) return;

    if (t.classList.contains("pm-acb")) { pickCity(t); return; }

    var place = t.getAttribute("data-place");
    if (place) { select(place); return; }

    var zoom = t.getAttribute("data-zoom");
    if (zoom && map) {
      if (zoom === "in") map.zoomBy(1.6);
      else if (zoom === "out") map.zoomBy(1 / 1.6);
      else map.resetZoom();
      return;
    }

    switch (t.getAttribute("data-act")) {
      case "add":
        form = blankForm();
        state.mode = "add";
        state.selectedId = null;
        render();
        var first = $('[data-f="city"]', els.card);
        if (first) first.focus();
        break;
      case "close":
        state.mode = "default";
        state.selectedId = null;
        form = blankForm();
        render();
        break;
      case "save":
        savePlace();
        break;
      case "copy":
        copyJSON(t);
        break;
      case "discard":
        if (!window.confirm("Discard " + draft.length + " unsaved place" + (draft.length === 1 ? "" : "s") + "?")) break;
        draft = [];
        saveDraft();
        state.selectedId = null;
        render();
        break;
      case "theme":
        setTheme(currentTheme() === "dark" ? "light" : "dark");
        break;
    }
  });

  els.year.addEventListener("change", function () { state.year = els.year.value; render(); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (state.mode === "add" || state.selectedId) {
      state.mode = "default";
      state.selectedId = null;
      form = blankForm();
      render();
    }
  });

  /* ---------- boot ---------- */

  function showTip(p, pos) {
    if (!p) { els.tip.hidden = true; return; }
    if (p.cluster) {
      els.tip.innerHTML = "<b>" + p.count + " places</b> <span>" +
        esc(p.names.slice(0, 3).join(", ")) +
        (p.count > 3 ? " +" + (p.count - 3) : "") + "</span>";
    } else {
      els.tip.innerHTML = "<b>" + esc(p.city) + "</b>" +
        (undated(p) ? "" : " <span>" + esc(dates(p)) + "</span>");
    }
    // Keep the tip inside the map box when the pin is near an edge.
    els.tip.style.left = Math.max(10, Math.min(90, pos.x)) + "%";
    els.tip.style.top = pos.y + "%";
    els.tip.hidden = false;
  }

  function fail(msg, err) {
    console.error(msg, err);
    els.list.innerHTML = '<p class="pm-listempty">' + esc(msg) + "</p>";
  }

  form = blankForm();
  draft = loadDraft();
  placesChanged();
  syncThemeButton();

  // A theme the viewer has not pinned follows the OS.
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onScheme = function () {
      var forced = new URLSearchParams(location.search).get("theme");
      if (forced || readStore(THEME_KEY)) return;
      document.documentElement.setAttribute("data-theme", mq.matches ? "light" : "dark");
      syncThemeButton();
    };
    if (mq.addEventListener) mq.addEventListener("change", onScheme);
  }

  Promise.all([
    fetch("data/places.json").then(function (r) { return r.json(); }),
    fetch("data/cities.json").then(function (r) { return r.json(); }).catch(function () { return []; })
  ]).then(function (res) {
    committed = res[0];
    placesChanged();
    cities = res[1];
    // Fold once at load rather than on every keystroke.
    cities.forEach(function (c) { c.k = fold(c.n); });

    // data/places.json is the source of truth: anything committed drops out of
    // the draft, so a place never appears twice after you paste and push.
    var ids = {};
    committed.forEach(function (p) { ids[p.id] = 1; });
    var kept = draft.filter(function (p) { return !ids[p.id]; });
    if (kept.length !== draft.length) { draft = kept; saveDraft(); }

    map = PlaceMap.create(els.mapwrap, {
      onPinClick: select,
      onPinHover: showTip,
      onZoom: function () { els.tip.hidden = true; },
      onMapClick: function (ll, country) {
        if (state.mode !== "add") return;
        form.lon = ll[0];
        form.lat = ll[1];
        if (country) {
          form.iso3 = country.iso3;
          if (!form.country) form.country = country.name;
        }
        form.error = "";
        renderCard();
      }
    });

    render();
    return map.ready;
  }).then(function () {
    render();
    // Inspection handles for the browser console. If a country will not tint,
    // __pmmap.hasCountry("SGP") says whether the map can draw it at all and
    // __pmmap.stepOf("PRT") says which fill it ended up with.
    window.__pmmap = map;
    window.__pmplaces = places();
  }).catch(function (err) {
    fail("Could not load the map. If you opened this file directly, serve it over http instead.", err);
  });
})();
