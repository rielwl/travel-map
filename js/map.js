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

  // Natural Earth 50m. 110m is a sixth of the payload but drops small
  // countries entirely (Singapore, Jeju, Langkawi had no polygon to tint) and
  // is too coarse at borders — it placed Mittenwald in Austria and Geneva in
  // France. 230KB gzipped, fetched once and cached.
  var WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";

  /* Natural Earth draws overseas departments as part of their parent country:
     France's polygon includes French Guiana, 7000km away in South America. A
     trip to Paris should not light up the Amazon coast, so a landmass only
     takes the tint if somewhere you have actually been is within reach of it.
     The threshold is generous — it keeps Tasmania lit from Melbourne (~200km),
     Hainan from Guangzhou (~300km) and Borneo from Kuala Lumpur (~1000km),
     while French Guiana misses by almost five times over. */
  var MAX_PART_KM = 1500;

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

      /* One path per landmass, not per country, so a detached overseas part
         can be left untinted while the mainland lights up. Each carries a
         thinned sample of its own outline for the distance test below. */
      gCountries = root.append("g").attr("class", "pm-countries");
      pathByIso3 = {};
      features.forEach(function (f) {
        if (!f.geometry) return;
        var polys = f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates.map(function (c) { return { type: "Polygon", coordinates: c }; })
          : [f.geometry];

        polys.forEach(function (poly) {
          var d = geoPath(poly);
          if (!d) return;
          var node = gCountries.append("path").attr("class", "pm-c").attr("d", d).node();
          if (!f.iso3) return;
          (pathByIso3[f.iso3] || (pathByIso3[f.iso3] = [])).push({
            node: node,
            outline: sampleRing(poly.coordinates[0])
          });
        });
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

      /* Both caches describe the SVG we just threw away. Neither key carries
         geometry, so without clearing them an unchanged place set would
         early-return and leave the freshly built layers blank. */
      lastSignature = null;
      lastTintKey = null;

      paintCountries();
      paintPins();
    }

    /* ---------- countries ---------- */

    function stepFor(n) {
      return n >= 3 ? 3 : n === 2 ? 2 : 1;
    }

    // Every 6th vertex is plenty against a 1500km threshold and keeps the
    // outlines small enough to walk on every repaint.
    function sampleRing(ring) {
      var out = [];
      for (var i = 0; i < ring.length; i += 6) out.push(ring[i]);
      if (out.length < 2 && ring.length) out.push(ring[ring.length - 1]);
      return out;
    }

    var EARTH_KM = 6371;
    var rad = function (d) { return d * Math.PI / 180; };

    function haversine(a, b) {
      var dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
      var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(rad(a[1])) * Math.cos(rad(b[1])) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
    }

    // Is any of this country's places close enough to this landmass?
    function partIsNear(outline, spots) {
      for (var i = 0; i < spots.length; i++) {
        for (var j = 0; j < outline.length; j++) {
          if (haversine(spots[i], outline[j]) <= MAX_PART_KM) return true;
        }
      }
      return false;
    }

    var lastTintKey = null;

    function paintCountries() {
      // The distance test walks a lot of coastline, so only redo it when the
      // data behind it actually changed. `places` is identity-stable between
      // renders, so this holds across filter and selection changes.
      var key = (state.places || []).length + ":" + JSON.stringify(state.visits);
      if (key === lastTintKey) return;
      lastTintKey = key;

      // Group the places by country once, so each landmass only tests against
      // the places that could possibly light it.
      var spotsByIso3 = {};
      (state.places || []).forEach(function (p) {
        if (!p.iso3) return;
        (spotsByIso3[p.iso3] || (spotsByIso3[p.iso3] = [])).push([p.lon, p.lat]);
      });

      Object.keys(pathByIso3).forEach(function (iso3) {
        var n = state.visits[iso3] || 0;
        var spots = spotsByIso3[iso3] || [];
        var tint = n > 0 ? "pm-c is-v" + stepFor(n) : "pm-c";

        pathByIso3[iso3].forEach(function (part) {
          var cls = (n > 0 && partIsNear(part.outline, spots)) ? tint : "pm-c";
          if (part.node.getAttribute("class") !== cls) part.node.setAttribute("class", cls);
        });
      });
    }

    /* ---------- pins ----------
     *
     * Pins that would overlap on screen collapse into one disc carrying the
     * count. Clustering is measured in POST-ZOOM units, so a cluster splits
     * apart as you zoom in rather than being baked in at one scale. Two pins
     * are never merged if either is selected — the detail card's pin has to
     * stay visible with its ring — and dimmed pins are left alone so a count
     * never includes something the filter excluded. */

    var CLUSTER_GAP = 15;   // post-zoom units between centres before merging
    var CLUSTER_R = 6.4;    // design's clustered-pin radius

    function layout() {
      var singles = [], clusterable = [];

      state.places.forEach(function (p) {
        var xy = proj([p.lon, p.lat]);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) return;
        var entry = { p: p, xy: xy, z: transform.apply(xy) };
        var dim = state.isDim && state.isDim(p);
        if (dim || p.id === state.selectedId) singles.push(entry);
        else clusterable.push(entry);
      });

      // Greedy single-pass grouping: near enough to an open group, join it.
      var groups = [];
      clusterable.forEach(function (e) {
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          if (Math.hypot(g.z[0] - e.z[0], g.z[1] - e.z[1]) < CLUSTER_GAP) {
            g.members.push(e);
            // Re-centre on the running mean so a group does not drift toward
            // whichever member happened to be first.
            var n = g.members.length;
            g.z = [
              g.members.reduce(function (s, m) { return s + m.z[0]; }, 0) / n,
              g.members.reduce(function (s, m) { return s + m.z[1]; }, 0) / n
            ];
            return;
          }
        }
        groups.push({ z: e.z.slice(), members: [e] });
      });

      var out = singles.map(function (e) { return { kind: "pin", e: e }; });
      groups.forEach(function (g) {
        if (g.members.length === 1) out.push({ kind: "pin", e: g.members[0] });
        else out.push({ kind: "cluster", group: g });
      });
      return out;
    }

    /* Rebuilding the pin layer on every zoom frame is wasteful when nothing
       has changed, so compare a cheap signature first. It has to cover
       everything that affects the rendered result, not just the grouping:
       moving the selection between two unclustered pins leaves the groups
       identical but still has to repaint both rings. */
    function signature(items) {
      return items.map(function (it) {
        if (it.kind === "cluster") {
          return "c" + it.group.members.map(function (m) { return m.p.id; }).sort().join(",");
        }
        var p = it.e.p;
        return "p" + p.id +
               (p.id === state.selectedId ? "*" : "") +
               (state.isDim && state.isDim(p) ? "-" : "");
      }).sort().join("|");
    }

    var lastSignature = null;

    /* Which node currently represents each place — its own pin, or the cluster
       it sits in. Used to put keyboard focus back after a rebuild. */
    var nodeForPlace = {};

    function paintPins(force) {
      var items = layout();
      var sig = signature(items);
      if (!force && sig === lastSignature) { applyPinScale(); return; }
      lastSignature = sig;

      /* Rebuilding destroys whatever the user was focused on, and browsers do
         not fire blur on removal, so focus would silently fall to <body> —
         which makes activating a cluster by keyboard a one-shot action. Note
         the place that node stood for, and focus whatever represents it after
         the rebuild. When a cluster splits, that is the sub-cluster or pin its
         first member ended up in. */
      var refocus = null;
      var active = document.activeElement;
      if (active && gPins.node().contains(active)) {
        refocus = Object.keys(nodeForPlace).filter(function (id) {
          return nodeForPlace[id] === active;
        })[0] || null;
      }

      gPins.selectAll("*").remove();
      pinById = {};
      nodeForPlace = {};

      items.forEach(function (it) {
        if (it.kind === "cluster") drawCluster(it.group);
        else drawPin(it.e);
      });

      // Selected pin last, so its ring is not covered by a neighbour.
      var sel = state.selectedId && pinById[state.selectedId];
      if (sel && sel.parentNode) sel.parentNode.appendChild(sel);

      if (refocus && nodeForPlace[refocus]) {
        nodeForPlace[refocus].focus({ preventScroll: true });
      }

      applyPinScale();
    }

    function drawPin(e) {
      var p = e.p;
      var g = gPins.append("g")
        .attr("class", pinClass(p))
        .attr("transform", "translate(" + e.xy[0].toFixed(2) + "," + e.xy[1].toFixed(2) + ")")
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", pinLabel(p));

      // Inner group carries the inverse zoom scale, so pins hold their size.
      var s = g.append("g").attr("class", "pm-pinscale");
      var r = dims.r;
      s.append("circle").attr("class", "pm-halo").attr("r", +(r * 2.4).toFixed(2));
      s.append("circle").attr("class", "pm-hit").attr("r", 9);
      s.append("circle").attr("class", "pm-core").attr("r", +r.toFixed(2));
      s.append("circle").attr("class", "pm-ring").attr("r", +(r * 3.1).toFixed(2))
        .attr("fill", "none").attr("stroke", p.id === state.selectedId ? "" : "none");

      var node = g.node();
      pinById[p.id] = node;
      nodeForPlace[p.id] = node;

      node.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (opts.onPinClick) opts.onPinClick(p.id);
      });
      node.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          if (opts.onPinClick) opts.onPinClick(p.id);
        }
      });
      node.addEventListener("mouseenter", function () { hover(p, node); });
      node.addEventListener("focus", function () { hover(p, node); });
      node.addEventListener("mouseleave", function () { hover(null); });
      node.addEventListener("blur", function () { hover(null); });
    }

    function drawCluster(group) {
      /* Position the group in the layer's OWN coordinates — the mean of its
         members' projected points. That is invariant under pan and zoom, so
         the handlers below can read the live transform instead of closing over
         a position that goes stale the moment the map is panned. */
      var n = group.members.length;
      var at = [
        group.members.reduce(function (s, m) { return s + m.xy[0]; }, 0) / n,
        group.members.reduce(function (s, m) { return s + m.xy[1]; }, 0) / n
      ];
      var names = group.members.map(function (m) { return m.p.city; });

      var g = gPins.append("g")
        .attr("class", "pm-cluster")
        .attr("transform", "translate(" + at[0].toFixed(2) + "," + at[1].toFixed(2) + ")")
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", n + " places here: " + names.slice(0, 6).join(", ") +
              (n > 6 ? ", and " + (n - 6) + " more" : "") + ". Activate to zoom in.");

      var s = g.append("g").attr("class", "pm-pinscale");
      s.append("circle").attr("class", "pm-cdisc").attr("r", CLUSTER_R);
      s.append("text").attr("class", "pm-ccount")
        .attr("text-anchor", "middle").attr("dy", "0.34em")
        .text(n);

      var node = g.node();
      group.members.forEach(function (m) { nodeForPlace[m.p.id] = node; });

      var open = function () {
        // Zoom toward the cluster; repeated activation keeps splitting it.
        // transform is read now, not captured, so panning cannot stale it.
        svg.transition().duration(250).call(zoom.scaleBy, 2.2, transform.apply(at));
      };
      node.addEventListener("click", function (ev) { ev.stopPropagation(); open(); });
      node.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); }
      });
      node.addEventListener("mouseenter", function () { hoverCluster(at, names); });
      node.addEventListener("focus", function () { hoverCluster(at, names); });
      node.addEventListener("mouseleave", function () { hover(null); });
      node.addEventListener("blur", function () { hover(null); });
    }

    // A cluster reports itself rather than a single place, so the tooltip can
    // say what activating it would open up. `at` is in layer coordinates; the
    // live transform turns it into a position on screen.
    function hoverCluster(at, names) {
      if (!opts.onPinHover) return;
      var z = transform.apply(at);
      opts.onPinHover(
        { cluster: true, count: names.length, names: names },
        { x: (z[0] / dims.w) * 100, y: (z[1] / dims.h) * 100 }
      );
    }

    function pinClass(p) {
      var c = "pm-pin";
      if (p.id === state.selectedId) c += " is-sel";
      if (state.isDim && state.isDim(p)) c += " is-dim";
      return c;
    }

    function pinLabel(p) {
      var when = !p.from ? "year unknown"
               : p.to ? p.from + " to " + p.to
               : p.from;
      return p.city + ", " + p.country + ". " + when + ".";
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
      // Re-cluster as the scale changes: groups split as you zoom in. paintPins
      // only touches the DOM when the grouping actually changed.
      paintPins();
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
      // Selection and filtering both change which pins are eligible to cluster,
      // so the layout is recomputed either way; paintPins skips the DOM work
      // when the grouping is unchanged.
      paintPins(placesChanged);
    };

    /* Inspection helpers. Handy from the console when a country is not
       tinting: hasCountry tells you whether 110m draws it at all, stepOf tells
       you which fill it actually has. */
    api.hasCountry = function (iso3) { return !!pathByIso3[iso3]; };

    api.stepOf = function (iso3) {
      var parts = pathByIso3[iso3];
      if (!parts) return 0;
      // Report the highest step across the country's landmasses: a detached
      // overseas part may be deliberately untinted while the mainland is lit.
      var best = 0;
      parts.forEach(function (part) {
        var m = /is-v([123])/.exec(part.node.getAttribute("class") || "");
        if (m && +m[1] > best) best = +m[1];
      });
      return best;
    };

    // How many of a country's landmasses are tinted, and how many it has.
    api.partsLit = function (iso3) {
      var parts = pathByIso3[iso3] || [];
      var lit = parts.filter(function (part) {
        return /is-v[123]/.test(part.node.getAttribute("class") || "");
      }).length;
      return { lit: lit, total: parts.length };
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
