/* Map rendering: d3-geo + Natural Earth 110m geometry.
 *
 * Two things here matter more than they look:
 *
 * 1. world-atlas identifies countries by ISO 3166-1 NUMERIC id ("620"), not
 *    alpha-3 and not name. Every join goes through data/iso-lookup.json.
 *    Matching on `properties.name` does not line up and is not attempted.
 *
 * 2. The base layers (sphere, graticule, ~177 country paths) are built once and
 *    then only ever have their `class` attribute rewritten. Re-serialising the
 *    country paths on each filter or selection is visibly slow.
 */
(function () {
  "use strict";

  // Natural Earth 110m. At this resolution a few very small countries have no
  // polygon at all — Singapore is the one most likely to matter here — so they
  // show a pin but never take the visited tint. Swapping this to
  // countries-50m.json fixes that at roughly 6x the payload; nothing else in
  // the code has to change.
  var WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";

  // Desktop and mobile carry their own viewBox so the pins stay legible at
  // small sizes rather than shrinking with the map.
  var SIZES = {
    desktop: { w: 688, h: 358, r: 2.8 },
    mobile:  { w: 334, h: 178, r: 2.1 }
  };

  // Ask the same media query the stylesheet uses, so the SVG geometry and the
  // CSS breakpoint can never disagree. Measuring the map container instead
  // looks right but is not: at a 1280px viewport the map column is only ~664px
  // wide, which would wrongly select the mobile artboard.
  var MOBILE_MQ = "(max-width: 700px)";

  function currentSize() {
    return window.matchMedia && window.matchMedia(MOBILE_MQ).matches ? "mobile" : "desktop";
  }

  function create(wrap, opts) {
    opts = opts || {};

    var api = {};
    var features = null;
    var lookup = null;
    var svg = null, root = null, gCountries = null, gPins = null;
    var proj = null, geoPath = null;
    var size = null, dims = null;
    var zoom = null, transform = null;
    var pathByIso3 = {};
    var pinById = {};
    var state = { visits: {}, places: [], selectedId: null, isDim: null };
    var adding = false;

    /* ---------- load ---------- */

    api.ready = Promise.all([
      fetch(WORLD_URL).then(okJson),
      fetch("data/iso-lookup.json").then(okJson)
    ]).then(function (res) {
      features = topojson.feature(res[0], res[0].objects.countries).features;
      lookup = res[1];
      // Resolve each feature's alpha-3 once, up front.
      features.forEach(function (f) {
        f.iso3 = lookup.numericToIso3[String(f.id)] || null;
      });
      build();
      return api;
    });

    function okJson(r) {
      if (!r.ok) throw new Error("Failed to load " + r.url + " (" + r.status + ")");
      return r.json();
    }

    /* ---------- build ---------- */

    function build() {
      size = currentSize();
      dims = SIZES[size];
      proj = d3.geoNaturalEarth1().fitExtent(
        [[4, 4], [dims.w - 4, dims.h - 4]], { type: "Sphere" }
      );
      geoPath = d3.geoPath(proj);

      var old = wrap.querySelector(".pm-map");
      if (old) old.remove();

      svg = d3.create("svg")
        .attr("class", "pm-map")
        .attr("viewBox", "0 0 " + dims.w + " " + dims.h)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("role", "img")
        .attr("aria-label", "World map of visited places");

      root = svg.append("g");

      root.append("path").attr("class", "pm-sphere").attr("d", geoPath({ type: "Sphere" }));
      root.append("path").attr("class", "pm-grat").attr("d", geoPath(d3.geoGraticule10()));

      gCountries = root.append("g").attr("class", "pm-countries");
      pathByIso3 = {};
      features.forEach(function (f) {
        var d = geoPath(f);
        if (!d) return;
        var p = gCountries.append("path").attr("class", "pm-c").attr("d", d).node();
        if (f.iso3) {
          // A country can arrive as several geometries; keep them all so the
          // whole country tints, not just one polygon.
          (pathByIso3[f.iso3] || (pathByIso3[f.iso3] = [])).push(p);
        }
      });

      gPins = root.append("g").attr("class", "pm-pins");

      zoom = d3.zoom()
        .scaleExtent([1, 8])
        .translateExtent([[0, 0], [dims.w, dims.h]])
        .extent([[0, 0], [dims.w, dims.h]])
        .on("zoom", onZoom);

      svg.call(zoom).on("dblclick.zoom", null);
      svg.on("dblclick", function () { api.resetZoom(); });
      svg.on("click", onSvgClick);

      wrap.insertBefore(svg.node(), wrap.firstChild);
      transform = d3.zoomIdentity;

      paintCountries();
      paintPins();
    }

    /* ---------- countries ---------- */

    function stepFor(n) {
      return n >= 3 ? 3 : n === 2 ? 2 : 1;
    }

    function paintCountries() {
      Object.keys(pathByIso3).forEach(function (iso3) {
        var n = state.visits[iso3] || 0;
        var cls = n > 0 ? "pm-c is-v" + stepFor(n) : "pm-c";
        pathByIso3[iso3].forEach(function (p) {
          if (p.getAttribute("class") !== cls) p.setAttribute("class", cls);
        });
      });
    }

    /* ---------- pins ---------- */

    function paintPins() {
      gPins.selectAll("*").remove();
      pinById = {};

      state.places.forEach(function (p) {
        var xy = proj([p.lon, p.lat]);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return;

        var g = gPins.append("g")
          .attr("class", pinClass(p))
          .attr("transform", "translate(" + xy[0].toFixed(2) + "," + xy[1].toFixed(2) + ")")
          .attr("tabindex", 0)
          .attr("role", "button")
          .attr("aria-label", pinLabel(p));

        // Inner group carries the inverse zoom scale, so pins hold their size.
        var s = g.append("g").attr("class", "pm-pinscale");
        var r = dims.r;
        s.append("circle").attr("class", "pm-halo").attr("r", +(r * 2.4).toFixed(2));
        s.append("circle").attr("class", "pm-hit").attr("r", 9);
        s.append("circle").attr("class", "pm-core")
          .attr("r", +((p.type === "lived" ? r * 1.3 : r)).toFixed(2));
        s.append("circle").attr("class", "pm-ring").attr("r", +(r * 3.1).toFixed(2))
          .attr("fill", "none").attr("stroke", "none");

        var node = g.node();
        pinById[p.id] = node;

        node.addEventListener("click", function (e) {
          e.stopPropagation();
          if (opts.onPinClick) opts.onPinClick(p.id);
        });
        node.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (opts.onPinClick) opts.onPinClick(p.id);
          }
        });
        node.addEventListener("mouseenter", function () { hover(p, node); });
        node.addEventListener("focus", function () { hover(p, node); });
        node.addEventListener("mouseleave", function () { hover(null); });
        node.addEventListener("blur", function () { hover(null); });
      });

      applyPinScale();
    }

    function pinClass(p) {
      var c = "pm-pin pm-pin-" + p.type;
      if (p.id === state.selectedId) c += " is-sel";
      if (state.isDim && state.isDim(p)) c += " is-dim";
      return c;
    }

    function pinLabel(p) {
      var dates = p.to ? p.from + " to " + p.to : p.from;
      var t = p.type === "passed" ? "passed through" : p.type;
      return p.city + ", " + p.country + ". " + t + ", " + dates + ".";
    }

    function repaintPinClasses() {
      state.places.forEach(function (p) {
        var node = pinById[p.id];
        if (!node) return;
        var cls = pinClass(p);
        if (node.getAttribute("class") !== cls) node.setAttribute("class", cls);
        // The selection ring is the only stroked circle; toggle it directly so
        // the CSS cascade does not have to fight the inline defaults.
        var ring = node.querySelector(".pm-ring");
        if (ring) ring.setAttribute("stroke", p.id === state.selectedId ? "" : "none");
      });
      // Selected pin last, so its ring is not covered by neighbouring pins.
      var sel = state.selectedId && pinById[state.selectedId];
      if (sel && sel.parentNode) sel.parentNode.appendChild(sel);
    }

    function hover(p, node) {
      if (!opts.onPinHover) return;
      if (!p) { opts.onPinHover(null); return; }
      var m = node.transform.baseVal.consolidate().matrix;
      var pt = transform.apply([m.e, m.f]);
      opts.onPinHover(p, {
        x: (pt[0] / dims.w) * 100,
        y: (pt[1] / dims.h) * 100
      });
    }

    /* ---------- zoom ---------- */

    function onZoom(event) {
      transform = event.transform;
      root.attr("transform", transform);
      applyPinScale();
      if (opts.onZoom) opts.onZoom(transform.k);
    }

    function applyPinScale() {
      var inv = 1 / transform.k;
      gPins.selectAll(".pm-pinscale").attr("transform", "scale(" + inv.toFixed(4) + ")");
    }

    api.zoomBy = function (f) { svg.transition().duration(150).call(zoom.scaleBy, f); };
    api.resetZoom = function () { svg.transition().duration(150).call(zoom.transform, d3.zoomIdentity); };

    /* ---------- click to drop a pin ---------- */

    function onSvgClick(event) {
      if (!adding || !opts.onMapClick) return;
      var pt = d3.pointer(event, svg.node());
      var map = transform.invert(pt);
      var ll = proj.invert(map);
      if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return;
      // Natural Earth projects the whole globe into a rounded rectangle; a
      // click in the corner inverts to a lon/lat that does not project back to
      // where it was clicked. Reject those rather than dropping a pin in a
      // place the user did not click.
      var back = proj(ll);
      if (!back || Math.hypot(back[0] - map[0], back[1] - map[1]) > 1) return;
      opts.onMapClick(ll, api.countryAt(ll));
    }

    api.setAdding = function (on) {
      adding = !!on;
      if (svg) svg.classed("is-adding", adding);
    };

    api.countryAt = function (ll) {
      for (var i = 0; i < features.length; i++) {
        if (features[i].iso3 && d3.geoContains(features[i], ll)) {
          return { iso3: features[i].iso3, name: lookup.names[features[i].iso3] || null };
        }
      }
      return null;
    };

    api.countryName = function (iso3) {
      return (lookup && lookup.names[iso3]) || null;
    };

    /* ---------- public update ---------- */

    api.update = function (next) {
      var placesChanged = next.places !== state.places;
      Object.keys(next).forEach(function (k) { state[k] = next[k]; });
      if (!svg) return;
      paintCountries();
      if (placesChanged) paintPins(); else repaintPinClasses();
    };

    /* Inspection helpers. Handy from the console when a country is not
       tinting: hasCountry tells you whether 110m draws it at all, stepOf tells
       you which fill it actually has. */
    api.hasCountry = function (iso3) { return !!pathByIso3[iso3]; };

    api.stepOf = function (iso3) {
      var paths = pathByIso3[iso3];
      if (!paths) return 0;
      var m = /is-v([123])/.exec(paths[0].getAttribute("class") || "");
      return m ? +m[1] : 0;
    };

    // Countries referenced by places that 110m cannot draw.
    api.undrawable = function (isoList) {
      return isoList.filter(function (c) { return c && !pathByIso3[c]; });
    };

    /* ---------- resize ---------- */

    var resizeTimer = null;
    function onResize() {
      if (!features) return;
      if (currentSize() === size) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        build();
        api.setAdding(adding);
      }, 120);
    }
    window.addEventListener("resize", onResize);

    return api;
  }

  window.PlaceMap = { create: create };
})();
