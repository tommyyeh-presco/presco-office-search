document.addEventListener("presco:authed", initMap, { once: true });

const LIGHT_RGB = [222, 235, 247]; // #deebf7
const DARK_RGB = [8, 48, 107];     // #08306b
const ZERO_BORDER_COLOR = "#b7c2cd";
const ZERO_FILL_COLOR = "#eef3f8";
const FILL_OPACITY = 0.6;
const COUNTY_BORDER_COLOR = "#22303f";
const BLACKOUT_COLOR = "#000000";

function interpolateColor(t) {
  const rgb = LIGHT_RGB.map((c, i) => Math.round(c + (DARK_RGB[i] - c) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function colorForCount(count, maxCount) {
  if (count === 0) return ZERO_FILL_COLOR;
  return interpolateColor(count / maxCount);
}

function borderColorForCount(count, maxCount) {
  if (count === 0) return ZERO_BORDER_COLOR;
  return interpolateColor(count / maxCount);
}

function borderWeightForCount(count, maxCount) {
  if (count === 0) return 1;
  return 1.5 + (count / maxCount) * 2.5;
}

// turf.pointOnFeature guarantees a point that lies on the feature itself
// (unlike a bounding-box center, which can land outside a concave or
// multi-part district shape).
function labelLatLng(feature) {
  const [lng, lat] = turf.pointOnFeature(feature).geometry.coordinates;
  return [lat, lng];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------------------------------------------------------------------
// City visibility (layer menu: blackout + hide pins per county)
// ---------------------------------------------------------------------

const ALL_COUNTIES = ["台北市", "新北市", "桃園市", "基隆市", "宜蘭縣"];
let hiddenCounties = new Set();
let mapRef = null;
let districtLayerRef = null;
let maxCountRef = 1;
let districtLabelMarkers = []; // [{ county, marker }]

function districtStyle(feature) {
  if (hiddenCounties.has(feature.properties.county)) {
    return { fillColor: BLACKOUT_COLOR, fillOpacity: 1, color: BLACKOUT_COLOR, weight: 0.5 };
  }
  return {
    fillColor: colorForCount(feature.properties.count, maxCountRef),
    fillOpacity: FILL_OPACITY,
    color: borderColorForCount(feature.properties.count, maxCountRef),
    weight: borderWeightForCount(feature.properties.count, maxCountRef),
  };
}

function applyCountyVisibility() {
  if (districtLayerRef) {
    districtLayerRef.eachLayer((lyr) => lyr.setStyle(districtStyle(lyr.feature)));
  }
  for (const { county, marker } of districtLabelMarkers) {
    const shouldShow = !hiddenCounties.has(county);
    const isShown = mapRef.hasLayer(marker);
    if (shouldShow && !isShown) marker.addTo(mapRef);
    if (!shouldShow && isShown) mapRef.removeLayer(marker);
  }
  renderListingPins();
}

function addLayerMenu(map) {
  const control = L.control({ position: "topleft" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "layer-menu");
    div.innerHTML =
      `<button type="button" id="layer-menu-toggle" class="layer-menu-button">☰ 圖層</button>` +
      `<div id="layer-menu-panel" class="layer-menu-panel" hidden>` +
      `<div class="layer-menu-title">隱藏城市（塗黑並移除物件）</div>` +
      ALL_COUNTIES.map(
        (c) =>
          `<label class="layer-menu-item"><input type="checkbox" class="county-toggle" value="${c}" checked> ${c}</label>`
      ).join("") +
      `</div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  control.addTo(map);

  document.getElementById("layer-menu-toggle").addEventListener("click", () => {
    const panel = document.getElementById("layer-menu-panel");
    panel.hidden = !panel.hidden;
  });

  document.querySelectorAll(".county-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) hiddenCounties.delete(checkbox.value);
      else hiddenCounties.add(checkbox.value);
      applyCountyVisibility();
    });
  });
}

async function addCountyOutlines(map) {
  const response = await fetch("data/counties.geo.json");
  const geojson = await response.json();
  L.geoJSON(geojson, {
    style: { fill: false, color: COUNTY_BORDER_COLOR, weight: 3, opacity: 1 },
    interactive: false,
  }).addTo(map);

  // Default view: centered on Taipei City, with New Taipei visible as the
  // surrounding border, rather than zoomed out to fit every county. (New
  // Taipei's own bounding box is unusable for this — its sprawling shape,
  // reaching out to mountains far from the city, makes its bounding box
  // nearly as large as the full 5-county extent.)
  const taipei = geojson.features.find((f) => f.properties.county === "台北市");
  return taipei ? L.geoJSON(taipei).getBounds() : null;
}

// Existing Presco office: 2F, No. 27, Sec. 1, Anhe Rd., Da'an Dist.,
// Taipei City 106646 — geocoded via OSM address data (Nominatim doesn't
// index this building's exact house number).
const CURRENT_OFFICE = {
  lat: 25.0391415,
  lng: 121.5503916,
  label: "現有辦公室：大安區安和路一段27號2樓",
};

function addOfficeMarker(map) {
  L.marker([CURRENT_OFFICE.lat, CURRENT_OFFICE.lng], {
    icon: L.divIcon({
      className: "office-star",
      html: "★",
      iconSize: [40, 40],
      iconAnchor: [20, 24],
    }),
  })
    .bindTooltip(CURRENT_OFFICE.label, { sticky: true })
    .addTo(map);
}

// ---------------------------------------------------------------------
// Listings: filters, pins, popup, and the detail sidebar
// ---------------------------------------------------------------------

// Listing data was fetched with a 300坪 floor (see scripts/fetch_591_listings.js)
// so the filter slider below can only raise the minimum, never lower it
// below what's actually in data/listings.geo.json. Price ceilings are
// rounded up from the actual data range for the same reason — the max
// slider position must mean "no filter", not "hide the priciest listings".
const MIN_AREA_FETCHED = 300;
const MAX_RENT_PRICE = 20000000; // 元/月
const MAX_SALE_PRICE = 310000; // 萬 — internal unit, matches unit.price
const MAX_SALE_PRICE_YI = 31; // 億 — the slider's displayed unit (1億 = 10,000萬)
const MAX_RENT_UNIT_PRICE = 7000; // 元/坪/月
const MAX_SALE_UNIT_PRICE = 200; // 萬/坪
const TYPE_LABELS = { 1: "租", 2: "售" };

let listingsGeojson = null;
let listingsLayerGroup = null;
let unitsById = new Map();
// Default reflects the actual space need (800坪), combinable across floors
// of the same building — not a single-unit minimum. The slider can still
// go down to the data floor or up higher, per "filter even higher" later.
let currentMinArea = 800;
let currentMaxRentPrice = MAX_RENT_PRICE;
let currentMaxSalePrice = MAX_SALE_PRICE;
let currentMaxRentUnitPrice = MAX_RENT_UNIT_PRICE;
let currentMaxSaleUnitPrice = MAX_SALE_UNIT_PRICE;

function parsePrice(priceStr) {
  return parseFloat(String(priceStr).replace(/,/g, "")) || 0;
}

// Unit-price (per-坪) caps are a rate, not a combinable total — checked
// per unit regardless of whether it ends up in a combined group.
function unitPassesUnitPriceFilter(unit) {
  const unitPrice = unit.price_per || 0;
  if (unit.type === 1) return unitPrice <= currentMaxRentUnitPrice;
  if (unit.type === 2) return unitPrice <= currentMaxSaleUnitPrice;
  return true;
}

// Units at the same building can be rented/bought together (different
// floors combining to meet the space need), but a rent listing and a
// sale listing can't be combined into one deal — group by type, and a
// group qualifies if ITS units' areas add up to the threshold, even if
// no single floor does alone.
function combinableGroups(units) {
  const byType = new Map();
  for (const unit of units) {
    if (!byType.has(unit.type)) byType.set(unit.type, []);
    byType.get(unit.type).push(unit);
  }
  return Array.from(byType.values());
}

// Returns the units from whichever combinable groups meet currentMinArea
// AND whose combined total price stays within the max-price slider — the
// total price is the sum across every unit in the group, since renting
// two floors together costs the sum of both, not just the pricier one.
function qualifyingUnits(allUnits) {
  const qualifying = [];
  for (const rawGroup of combinableGroups(allUnits)) {
    const group = rawGroup.filter(unitPassesUnitPriceFilter);
    if (group.length === 0) continue;

    const totalArea = group.reduce((sum, u) => sum + u.area, 0);
    if (totalArea < currentMinArea) continue;

    const totalPrice = group.reduce((sum, u) => sum + parsePrice(u.price), 0);
    const maxPrice = group[0].type === 1 ? currentMaxRentPrice : currentMaxSalePrice;
    if (totalPrice > maxPrice) continue;

    qualifying.push(...group);
  }
  return qualifying;
}

function pinClassForUnits(units) {
  const hasRent = units.some((u) => u.type === 1);
  const hasSale = units.some((u) => u.type === 2);
  if (hasRent && hasSale) return "listing-pin-mixed";
  return hasSale ? "listing-pin-sale" : "listing-pin-rent";
}

function unitRowHtml(u) {
  return `
      <div class="listing-unit">
        <a href="#" onclick="openListingSidebar(${u.id}); return false;">
          [${escapeHtml(TYPE_LABELS[u.type] || "")}] ${escapeHtml(u.title)}
        </a>
        <div class="listing-unit-meta">
          ${escapeHtml(u.floor_name || "")} · ${escapeHtml(u.area_name || "")} ·
          ${escapeHtml(u.price || "")}${escapeHtml(u.price_unit || "")}
        </div>
      </div>`;
}

function buildListingPopupHtml(props, units) {
  const sections = combinableGroups(units)
    .map((group) => {
      const totalArea = group.reduce((sum, u) => sum + u.area, 0);
      const totalPrice = group.reduce((sum, u) => sum + parsePrice(u.price), 0);
      const priceUnit = group[0].price_unit || "";
      const combinedNote =
        group.length > 1
          ? `<div class="listing-combined-note">可合併${escapeHtml(TYPE_LABELS[group[0].type] || "")}：共 ${totalArea.toFixed(1)} 坪，總${escapeHtml(TYPE_LABELS[group[0].type] === "售" ? "價" : "租金")} ${totalPrice.toLocaleString()}${escapeHtml(priceUnit)}（${group.length} 個樓層）</div>`
          : "";
      return combinedNote + group.map(unitRowHtml).join("");
    })
    .join("");
  return (
    `<div class="listing-popup">` +
    `<strong>${escapeHtml(props.community_name || props.address)}</strong>` +
    `<div class="listing-popup-address">${escapeHtml(props.address)}</div>` +
    sections +
    `</div>`
  );
}

function renderListingPins() {
  listingsLayerGroup.clearLayers();
  for (const feature of listingsGeojson.features) {
    if (hiddenCounties.has(feature.properties.county)) continue;
    const units = qualifyingUnits(feature.properties.units);
    if (units.length === 0) continue;
    const [lng, lat] = feature.geometry.coordinates;
    L.marker([lat, lng], {
      icon: L.divIcon({
        className: `listing-pin ${pinClassForUnits(units)}`,
        html: units.length > 1 ? `<span>${units.length}</span>` : "",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    })
      .bindPopup(buildListingPopupHtml(feature.properties, units), { maxWidth: 320 })
      .addTo(listingsLayerGroup);
  }
}

function addListingsFilterControl(map) {
  const control = L.control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "listings-filter");
    div.innerHTML =
      `<label>最小總坪數（可合併樓層）：<span id="min-area-value">${currentMinArea}</span> 坪</label>` +
      `<input type="range" id="min-area-slider" min="${MIN_AREA_FETCHED}" max="3000" step="50" value="${currentMinArea}">` +
      `<label>最高月租金（合併總額）：<span id="max-rent-value">${currentMaxRentPrice.toLocaleString()}</span> 元/月</label>` +
      `<input type="range" id="max-rent-slider" min="0" max="${MAX_RENT_PRICE}" step="50000" value="${currentMaxRentPrice}">` +
      `<label>最高租金單價：<span id="max-rent-unit-value">${currentMaxRentUnitPrice.toLocaleString()}</span> 元/坪/月</label>` +
      `<input type="range" id="max-rent-unit-slider" min="0" max="${MAX_RENT_UNIT_PRICE}" step="100" value="${currentMaxRentUnitPrice}">` +
      `<label>最高總價（合併總額）：<span id="max-sale-value">${(currentMaxSalePrice / 10000).toFixed(1)}</span> 億</label>` +
      `<input type="range" id="max-sale-slider" min="0" max="${MAX_SALE_PRICE_YI}" step="0.5" value="${currentMaxSalePrice / 10000}">` +
      `<label>最高售價單價：<span id="max-sale-unit-value">${currentMaxSaleUnitPrice.toLocaleString()}</span> 萬/坪</label>` +
      `<input type="range" id="max-sale-unit-slider" min="0" max="${MAX_SALE_UNIT_PRICE}" step="5" value="${currentMaxSaleUnitPrice}">`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  control.addTo(map);

  const bindSlider = (sliderId, labelId, apply, options = {}) => {
    const parse = options.parse || ((v) => parseInt(v, 10));
    const format = options.format || ((v) => v.toLocaleString());
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    slider.addEventListener("input", () => {
      const value = parse(slider.value);
      label.textContent = format(value);
      apply(value);
      renderListingPins();
    });
  };

  bindSlider("min-area-slider", "min-area-value", (v) => (currentMinArea = v));
  bindSlider("max-rent-slider", "max-rent-value", (v) => (currentMaxRentPrice = v));
  bindSlider("max-rent-unit-slider", "max-rent-unit-value", (v) => (currentMaxRentUnitPrice = v));
  // Sale total price is shown/entered in 億 (1億 = 10,000萬) since raw 萬
  // values are hard to read at this scale, but stored internally in 萬
  // (currentMaxSalePrice) to compare directly against unit.price, which
  // 591 reports in 萬.
  bindSlider("max-sale-slider", "max-sale-value", (v) => (currentMaxSalePrice = v * 10000), {
    parse: (v) => parseFloat(v),
    format: (v) => v.toFixed(1),
  });
  bindSlider("max-sale-unit-slider", "max-sale-unit-value", (v) => (currentMaxSaleUnitPrice = v));
}

function addListingsLegend(map) {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend listings-legend");
    div.innerHTML =
      "<strong>物件標記</strong>" +
      '<div><span class="swatch listing-pin-rent"></span>出租</div>' +
      '<div><span class="swatch listing-pin-sale"></span>出售</div>' +
      '<div><span class="swatch listing-pin-mixed"></span>租售皆有</div>';
    return div;
  };
  legend.addTo(map);
}

function indexUnits(geojson) {
  unitsById.clear();
  for (const feature of geojson.features) {
    for (const unit of feature.properties.units) {
      unitsById.set(unit.id, {
        ...unit,
        community_name: feature.properties.community_name,
        address: feature.properties.address,
      });
    }
  }
}

function buildSidebarHtml(unit) {
  const photos = (unit.photos || [])
    .map((url) => `<img src="${escapeHtml(url)}" alt="" loading="lazy">`)
    .join("");
  const tags = (unit.tags || [])
    .map((t) => `<span class="sidebar-tag">${escapeHtml(t)}</span>`)
    .join("");
  const nearby =
    unit.surrounding && unit.surrounding.desc
      ? `<div class="sidebar-fact"><span>鄰近</span><span>${escapeHtml(unit.surrounding.desc)} ${escapeHtml(unit.surrounding.distance || "")}</span></div>`
      : "";
  const unitPrice = unit.price_per
    ? `<span class="sidebar-unit-price">(${unit.price_per}${escapeHtml(unit.price_per_unit || "")})</span>`
    : "";

  return (
    `<div class="sidebar-photos">${photos || '<div class="sidebar-no-photo">無照片</div>'}</div>` +
    `<div class="sidebar-body">` +
    `<span class="sidebar-type-badge">${escapeHtml(TYPE_LABELS[unit.type] || "")}</span>` +
    `<h3>${escapeHtml(unit.title)}</h3>` +
    `<div class="sidebar-community">${escapeHtml(unit.community_name || unit.address || "")}</div>` +
    `<div class="sidebar-price">${escapeHtml(unit.price || "")}${escapeHtml(unit.price_unit || "")} ${unitPrice}</div>` +
    `<div class="sidebar-facts">` +
    `<div class="sidebar-fact"><span>樓層</span><span>${escapeHtml(unit.floor_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>坪數</span><span>${escapeHtml(unit.area_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>裝潢</span><span>${escapeHtml(unit.fitment_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>更新</span><span>${escapeHtml(unit.refresh_time || "")}</span></div>` +
    nearby +
    `</div>` +
    `<div class="sidebar-tags">${tags}</div>` +
    `<a href="${escapeHtml(unit.url)}" target="_blank" rel="noopener noreferrer" class="sidebar-591-link">在591查看完整資訊 →</a>` +
    `</div>`
  );
}

function openListingSidebar(unitId) {
  const unit = unitsById.get(unitId);
  if (!unit) return;
  document.getElementById("listing-sidebar-content").innerHTML = buildSidebarHtml(unit);
  document.getElementById("listing-sidebar").classList.add("open");
}

function closeListingSidebar() {
  document.getElementById("listing-sidebar").classList.remove("open");
}

async function addListings(map) {
  const response = await fetch("data/listings.geo.json");
  listingsGeojson = await response.json();
  indexUnits(listingsGeojson);
  listingsLayerGroup = L.layerGroup().addTo(map);
  renderListingPins();
  addListingsFilterControl(map);
  addListingsLegend(map);
}

async function addMrtLines(map) {
  const response = await fetch("data/mrt.geo.json");
  const geojson = await response.json();
  L.geoJSON(geojson, {
    style: (feature) => ({
      color: feature.properties.colour,
      weight: 3,
      opacity: 0.9,
    }),
    onEachFeature: (feature, lyr) => {
      lyr.bindTooltip(feature.properties.name, { sticky: true });
    },
  }).addTo(map);
}

async function initMap() {
  const map = L.map("map");
  mapRef = map;
  // Minimal, near-monochrome basemap — just roads (no colored land/water
  // fill, no labels/POI/building clutter) so the district choropleth and
  // MRT overlay stay legible.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  const response = await fetch("data/districts.geo.json");
  const geojson = await response.json();
  maxCountRef = Math.max(...geojson.features.map((f) => f.properties.count));

  const districtLayer = L.geoJSON(geojson, {
    style: districtStyle,
    onEachFeature: (feature, lyr) => {
      const { name, county, count } = feature.properties;
      lyr.bindTooltip(`${county}${name}：${count} 人`, { sticky: true });
      if (count > 0) {
        const marker = L.marker(labelLatLng(feature), {
          icon: L.divIcon({
            className: "district-label",
            html:
              `<div class="district-label-pin">` +
              `<div class="district-label-count">${count}</div>` +
              `<div class="district-label-name">${name}</div>` +
              `</div>`,
            iconSize: [90, 58],
            iconAnchor: [45, 58],
          }),
          interactive: false,
        }).addTo(map);
        districtLabelMarkers.push({ county, marker });
      }
    },
  }).addTo(map);
  districtLayerRef = districtLayer;

  const taipeiBounds = await addCountyOutlines(map);
  addMrtLines(map);
  addOfficeMarker(map);
  addListings(map);
  addLayerMenu(map);

  document.getElementById("listing-sidebar-close").addEventListener("click", closeListingSidebar);

  // The map container is unhidden in the same tick as initMap() runs (the
  // password gate reveals #app right before dispatching the "presco:authed"
  // event). Leaflet can still measure a zero-size container at that exact
  // synchronous point, before the browser's next layout/paint pass — so
  // defer sizing to the next animation frame, once layout has settled.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(taipeiBounds || districtLayer.getBounds(), { padding: [160, 160] });
  });

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML =
      "<strong>員工人數</strong>" +
      '<div class="legend-gradient"></div>' +
      `<div class="legend-scale"><span>0</span><span>${maxCountRef}</span></div>`;
    return div;
  };
  legend.addTo(map);
}
