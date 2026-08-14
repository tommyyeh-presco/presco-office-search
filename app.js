const LIGHT_RGB = [222, 235, 247]; // #deebf7
const DARK_RGB = [8, 48, 107];     // #08306b
const ZERO_BORDER_COLOR = "#b7c2cd";
const ZERO_FILL_COLOR = "#eef3f8";
const FILL_OPACITY = 0.6;
const COUNTY_BORDER_COLOR = "#22303f";

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
// District choropleth
// ---------------------------------------------------------------------

const COUNTY_DISPLAY_ORDER = ["台北市", "新北市", "桃園市", "基隆市", "宜蘭縣"];
let mapRef = null;
let districtLayerRef = null;
let maxCountRef = 1;

function districtStyle(feature) {
  return {
    fillColor: colorForCount(feature.properties.count, maxCountRef),
    fillOpacity: FILL_OPACITY,
    color: borderColorForCount(feature.properties.count, maxCountRef),
    weight: borderWeightForCount(feature.properties.count, maxCountRef),
  };
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
let listingsPanelBodyEl = null;

// Map layer visibility, controlled by the top-right 顯示項目 card. Kept
// separate from the filter sliders (a different card) per request.
let employeeCountVisible = true;
let rentVisible = true;
let saleVisible = true;
let avgPriceVisible = false;
let districtLabelMarkers = []; // [{ feature, marker }]
// Default reflects the actual space need (800坪), combinable across floors
// of the same building — not a single-unit minimum. The slider can still
// go down to the data floor or up higher, per "filter even higher" later.
let currentMinArea = 800;
let currentMaxRentPrice = 4000000;
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
      const avgUnitPrice = totalArea > 0 ? totalPrice / totalArea : 0;
      const unitPriceUnit = group[0].price_per_unit || "";
      const combinedNote =
        group.length > 1
          ? `<div class="listing-combined-note">可合併${escapeHtml(TYPE_LABELS[group[0].type] || "")}：共 ${totalArea.toFixed(1)} 坪，總${escapeHtml(TYPE_LABELS[group[0].type] === "售" ? "價" : "租金")} ${totalPrice.toLocaleString()}${escapeHtml(priceUnit)}，平均 ${avgUnitPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${escapeHtml(unitPriceUnit)}（${group.length} 個樓層）</div>`
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
    const units = qualifyingUnits(feature.properties.units).filter(
      (u) => (u.type === 1 && rentVisible) || (u.type === 2 && saleVisible)
    );
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

// Top-right panel: filter sliders and pin-type legend. Layer visibility
// (including whether rent/sale pins show at all) lives in the separate
// 顯示項目 card added by addLayersPanel — this card hides itself only
// when neither listing type is toggled on there.
function addListingsPanel(map) {
  const control = L.control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "listings-panel");
    div.innerHTML =
      `<div class="listings-filter">` +
      `<label>最小總坪數（可合併樓層）：<span id="min-area-value">${currentMinArea}</span> 坪</label>` +
      `<input type="range" id="min-area-slider" min="${MIN_AREA_FETCHED}" max="3000" step="50" value="${currentMinArea}">` +
      `<label>最高月租金（合併總額）：<span id="max-rent-value">${currentMaxRentPrice.toLocaleString()}</span> 元/月</label>` +
      `<input type="range" id="max-rent-slider" min="0" max="${MAX_RENT_PRICE}" step="50000" value="${currentMaxRentPrice}">` +
      `<label>最高租金單價：<span id="max-rent-unit-value">${currentMaxRentUnitPrice.toLocaleString()}</span> 元/坪/月</label>` +
      `<input type="range" id="max-rent-unit-slider" min="0" max="${MAX_RENT_UNIT_PRICE}" step="100" value="${currentMaxRentUnitPrice}">` +
      `<label>最高總價（合併總額）：<span id="max-sale-value">${(currentMaxSalePrice / 10000).toFixed(1)}</span> 億</label>` +
      `<input type="range" id="max-sale-slider" min="0" max="${MAX_SALE_PRICE_YI}" step="0.5" value="${currentMaxSalePrice / 10000}">` +
      `<label>最高售價單價：<span id="max-sale-unit-value">${currentMaxSaleUnitPrice.toLocaleString()}</span> 萬/坪</label>` +
      `<input type="range" id="max-sale-unit-slider" min="0" max="${MAX_SALE_UNIT_PRICE}" step="5" value="${currentMaxSaleUnitPrice}">` +
      `</div>` +
      `<div class="listings-legend">` +
      "<strong>物件標記</strong>" +
      '<div><span class="swatch listing-pin-rent"></span>出租</div>' +
      '<div><span class="swatch listing-pin-sale"></span>出售</div>' +
      '<div><span class="swatch listing-pin-mixed"></span>租售皆有</div>' +
      `</div>`;
    L.DomEvent.disableClickPropagation(div);
    listingsPanelBodyEl = div;
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
      // The average-price district labels are derived from qualifying
      // listings too, so they need to stay in sync with these sliders.
      if (avgPriceVisible) refreshDistrictLabels();
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

// Hides the filter-sliders card when neither listing type is toggled on
// in the 顯示項目 card — no point filtering pins that aren't shown.
function applyListingsVisibility() {
  const anyVisible = rentVisible || saleVisible;
  if (anyVisible) {
    if (!mapRef.hasLayer(listingsLayerGroup)) listingsLayerGroup.addTo(mapRef);
  } else if (mapRef.hasLayer(listingsLayerGroup)) {
    mapRef.removeLayer(listingsLayerGroup);
  }
  if (listingsPanelBodyEl) listingsPanelBodyEl.style.display = anyVisible ? "" : "none";
}

// Average unit price per district, split by type since rent (元/坪/月)
// and sale (萬/坪) aren't the same unit and can't be blended into one
// number. Built from the same qualifyingUnits() the pins/sliders use, so
// it stays consistent with whatever's currently filtered in.
function computeDistrictAvgPrices() {
  const byDistrict = new Map(); // `${county}|${district}` -> {rentSum, rentCount, saleSum, saleCount}
  if (!listingsGeojson) return byDistrict;
  for (const feature of listingsGeojson.features) {
    const units = qualifyingUnits(feature.properties.units);
    if (units.length === 0) continue;
    const key = `${feature.properties.county}|${feature.properties.district}`;
    if (!byDistrict.has(key)) byDistrict.set(key, { rentSum: 0, rentCount: 0, saleSum: 0, saleCount: 0 });
    const agg = byDistrict.get(key);
    for (const u of units) {
      const pricePer = u.price_per;
      if (!pricePer || pricePer <= 0) continue;
      if (u.type === 1) {
        agg.rentSum += pricePer;
        agg.rentCount += 1;
      } else if (u.type === 2) {
        agg.saleSum += pricePer;
        agg.saleCount += 1;
      }
    }
  }
  return byDistrict;
}

// Builds whichever lines are currently enabled for one district's label.
// The district name itself is not gated by 居住地人數 — it's the "where
// am I" line and stays on whenever the marker has anything else to show;
// only the count number is controlled by that toggle. Caller hides the
// marker entirely when this returns an empty string (nothing to show at
// all — e.g. 0 employees and no qualifying listings).
function districtLabelContent(feature, avgPrices) {
  const { name, county, count } = feature.properties;

  const countLine = employeeCountVisible && count > 0
    ? `<div class="district-label-count">${count}</div>`
    : "";

  let priceLine = "";
  if (avgPriceVisible && avgPrices) {
    const agg = avgPrices.get(`${county}|${name}`);
    if (agg) {
      const parts = [];
      if (agg.rentCount > 0) {
        parts.push(`租 ${Math.round(agg.rentSum / agg.rentCount).toLocaleString()}元/坪/月`);
      }
      if (agg.saleCount > 0) {
        parts.push(`售 ${(agg.saleSum / agg.saleCount).toFixed(1)}萬/坪`);
      }
      if (parts.length > 0) {
        priceLine = `<div class="district-label-price">${parts.join(" · ")}</div>`;
      }
    }
  }

  if (!countLine && !priceLine && count === 0) return "";

  const nameLine = `<div class="district-label-name">${name}</div>`;
  return countLine + nameLine + priceLine;
}

// Rebuilds every district label's content from current toggle state, and
// shows/hides each marker depending on whether it ends up with anything
// to say — e.g. a district can have qualifying listings but 0 employees.
function refreshDistrictLabels() {
  const avgPrices = avgPriceVisible ? computeDistrictAvgPrices() : null;
  for (const { feature, marker } of districtLabelMarkers) {
    const html = districtLabelContent(feature, avgPrices);
    if (!html) {
      if (mapRef.hasLayer(marker)) mapRef.removeLayer(marker);
      continue;
    }
    marker.setIcon(
      L.divIcon({ className: "district-label", html, iconSize: [110, 58], iconAnchor: [55, 29] })
    );
    if (!mapRef.hasLayer(marker)) marker.addTo(mapRef);
  }
}

// Top-right card, separate from the filter-sliders card, controlling what
// shows on the map at all: district employee-count labels, rent/sale
// pins, and the average-unit-price district labels. 全顯示 is a "select
// all" shortcut, not a 5th independent layer.
function addLayersPanel(map) {
  const control = L.control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "layers-panel");
    div.innerHTML =
      `<div class="layers-panel-title">顯示項目</div>` +
      `<label class="layers-toggle-row"><input type="checkbox" id="layer-all"> 全顯示</label>` +
      `<label class="layers-toggle-row"><input type="checkbox" id="layer-employee-count" checked> 居住地人數</label>` +
      `<label class="layers-toggle-row"><input type="checkbox" id="layer-rent" checked> 承租物件</label>` +
      `<label class="layers-toggle-row"><input type="checkbox" id="layer-sale" checked> 交易物件</label>` +
      `<label class="layers-toggle-row"><input type="checkbox" id="layer-avg-price"> 平均單價</label>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  control.addTo(map);

  const allBox = document.getElementById("layer-all");
  const subBoxes = [
    { el: document.getElementById("layer-employee-count"), setter: (v) => (employeeCountVisible = v) },
    { el: document.getElementById("layer-rent"), setter: (v) => (rentVisible = v) },
    { el: document.getElementById("layer-sale"), setter: (v) => (saleVisible = v) },
    { el: document.getElementById("layer-avg-price"), setter: (v) => (avgPriceVisible = v) },
  ];

  const syncAllCheckbox = () => {
    const states = subBoxes.map((b) => b.el.checked);
    const allOn = states.every(Boolean);
    const allOff = states.every((s) => !s);
    allBox.checked = allOn;
    allBox.indeterminate = !allOn && !allOff;
  };

  const applyLayerToggles = () => {
    renderListingPins();
    refreshDistrictLabels();
    applyListingsVisibility();
  };

  allBox.addEventListener("change", () => {
    subBoxes.forEach((b) => {
      b.el.checked = allBox.checked;
      b.setter(allBox.checked);
    });
    allBox.indeterminate = false;
    applyLayerToggles();
  });

  subBoxes.forEach((b) => {
    b.el.addEventListener("change", () => {
      b.setter(b.el.checked);
      syncAllCheckbox();
      applyLayerToggles();
    });
  });

  syncAllCheckbox();
}

function indexUnits(geojson) {
  unitsById.clear();
  for (const feature of geojson.features) {
    for (const unit of feature.properties.units) {
      unitsById.set(unit.id, {
        ...unit,
        community_name: feature.properties.community_name,
        address: feature.properties.address,
        building_age: feature.properties.building_age,
      });
    }
  }
}

// Building age isn't from 591 — it's a small, separately researched
// dataset (see data/building_ages.json) covering only buildings with a
// name specific enough to identify uniquely. Shown with a confidence
// label and source link since it's not as reliable as 591's own fields.
const CONFIDENCE_LABELS = { high: "高", medium: "中", low: "低" };

function buildSidebarHtml(unit) {
  const photos = (unit.photos || [])
    .map((url, i) => `<img src="${escapeHtml(url)}" alt="" loading="lazy" onclick="openLightbox(${i})">`)
    .join("");
  const tags = (unit.tags || [])
    .map((t) => `<span class="sidebar-tag">${escapeHtml(t)}</span>`)
    .join("");
  const nearby =
    unit.surrounding && unit.surrounding.desc
      ? `<div class="sidebar-fact"><span>鄰近</span><span>${escapeHtml(unit.surrounding.desc)} ${escapeHtml(unit.surrounding.distance || "")}</span></div>`
      : "";
  const buildingAge = unit.building_age
    ? `<div class="sidebar-fact"><span>屋齡</span><span>${unit.building_age.age_years}年（${unit.building_age.year}年完工）` +
      `<span class="sidebar-confidence sidebar-confidence-${escapeHtml(unit.building_age.confidence)}">信賴度：${escapeHtml(CONFIDENCE_LABELS[unit.building_age.confidence] || unit.building_age.confidence)}</span></span></div>` +
      (unit.building_age.source
        ? `<div class="sidebar-age-source">屋齡資料來源：<a href="${escapeHtml(unit.building_age.source)}" target="_blank" rel="noopener noreferrer">查看</a></div>`
        : "")
    : "";
  const unitPrice = unit.price_per
    ? `<span class="sidebar-unit-price">(${unit.price_per}${escapeHtml(unit.price_per_unit || "")})</span>`
    : "";

  return (
    `<div class="sidebar-body">` +
    `<span class="sidebar-type-badge">${escapeHtml(TYPE_LABELS[unit.type] || "")}</span>` +
    `<h3>${escapeHtml(unit.title)}</h3>` +
    `<div class="sidebar-community">${escapeHtml(unit.community_name || unit.address || "")}</div>` +
    `<div class="sidebar-price">${escapeHtml(unit.price || "")}${escapeHtml(unit.price_unit || "")} ${unitPrice}</div>` +
    `<div class="sidebar-facts">` +
    `<div class="sidebar-fact"><span>樓層</span><span>${escapeHtml(unit.floor_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>使用坪數</span><span>${escapeHtml(unit.area_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>裝潢</span><span>${escapeHtml(unit.fitment_name || "")}</span></div>` +
    `<div class="sidebar-fact"><span>更新</span><span>${escapeHtml(unit.refresh_time || "")}</span></div>` +
    buildingAge +
    nearby +
    `</div>` +
    `<div class="sidebar-tags">${tags}</div>` +
    `<div class="sidebar-photos">${photos || '<div class="sidebar-no-photo">無照片</div>'}</div>` +
    `<a href="${escapeHtml(unit.url)}" target="_blank" rel="noopener noreferrer" class="sidebar-591-link">在591查看完整資訊 →</a>` +
    `</div>`
  );
}

function openListingSidebar(unitId) {
  const unit = unitsById.get(unitId);
  if (!unit) return;
  currentSidebarUnit = unit;
  document.getElementById("listing-sidebar-content").innerHTML = buildSidebarHtml(unit);
  document.getElementById("listing-sidebar").classList.add("open");
}

function closeListingSidebar() {
  document.getElementById("listing-sidebar").classList.remove("open");
}

// ---------------------------------------------------------------------
// Photo lightbox
// ---------------------------------------------------------------------

let currentSidebarUnit = null;
let lightboxIndex = 0;

function renderLightbox() {
  const photos = currentSidebarUnit.photos;
  document.getElementById("photo-lightbox-img").src = photos[lightboxIndex];
  document.getElementById("photo-lightbox-counter").textContent = `${lightboxIndex + 1} / ${photos.length}`;
}

function openLightbox(index) {
  if (!currentSidebarUnit || !currentSidebarUnit.photos || currentSidebarUnit.photos.length === 0) return;
  lightboxIndex = index;
  renderLightbox();
  document.getElementById("photo-lightbox").classList.add("open");
}

function closeLightbox() {
  document.getElementById("photo-lightbox").classList.remove("open");
}

function lightboxStep(delta) {
  const photos = currentSidebarUnit.photos;
  lightboxIndex = (lightboxIndex + delta + photos.length) % photos.length;
  renderLightbox();
}

function initLightboxControls() {
  document.getElementById("photo-lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("photo-lightbox-prev").addEventListener("click", () => lightboxStep(-1));
  document.getElementById("photo-lightbox-next").addEventListener("click", () => lightboxStep(1));
  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("photo-lightbox").classList.contains("open")) return;
    if (e.key === "ArrowLeft") lightboxStep(-1);
    else if (e.key === "ArrowRight") lightboxStep(1);
    else if (e.key === "Escape") closeLightbox();
  });
}

async function addListings(map) {
  const response = await fetch("data/listings.geo.json");
  listingsGeojson = await response.json();
  indexUnits(listingsGeojson);
  listingsLayerGroup = L.layerGroup().addTo(map);
  renderListingPins();
  addListingsPanel(map);
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
      const marker = L.marker(labelLatLng(feature), {
        icon: L.divIcon({ className: "district-label", html: "", iconSize: [110, 58], iconAnchor: [55, 29] }),
        interactive: false,
      });
      districtLabelMarkers.push({ feature, marker });
    },
  }).addTo(map);
  districtLayerRef = districtLayer;
  refreshDistrictLabels();

  const taipeiBounds = await addCountyOutlines(map);
  addMrtLines(map);
  addOfficeMarker(map);
  addLayersPanel(map);
  addListings(map);

  document.getElementById("listing-sidebar-close").addEventListener("click", closeListingSidebar);
  initLightboxControls();

  // The map container is unhidden in the same tick as initMap() runs (the
  // password gate reveals #app right before dispatching the "presco:authed"
  // event). Leaflet can still measure a zero-size container at that exact
  // synchronous point, before the browser's next layout/paint pass — so
  // defer sizing to the next animation frame, once layout has settled.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(taipeiBounds || districtLayer.getBounds(), { padding: [160, 160] });
  });

  // Two separate bottom-right cards, not one: the gradient's width shouldn't
  // stretch every time the breakdown card below it expands/collapses. Leaflet
  // stacks bottom-corner controls with the most-recently-added one on top, so
  // the breakdown card is added first to put the gradient card above it.
  let countyBarsExpanded = false;
  const breakdownLegend = L.control({ position: "bottomright" });
  breakdownLegend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend county-breakdown-card");
    div.innerHTML =
      `<div class="county-bars-header">` +
      `<button type="button" id="county-bars-toggle" class="county-bars-toggle-btn" aria-label="展開">▶</button>` +
      `<span>依區域分佈</span>` +
      `</div>` +
      `<div id="county-bars-container">${countyBarsHtml(geojson)}</div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  breakdownLegend.addTo(map);

  const gradientLegend = L.control({ position: "bottomright" });
  gradientLegend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML =
      "<strong>員工人數</strong>" +
      '<div class="legend-gradient"></div>' +
      `<div class="legend-scale"><span>0</span><span>${maxCountRef}</span></div>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  gradientLegend.addTo(map);

  document.getElementById("county-bars-toggle").addEventListener("click", () => {
    countyBarsExpanded = !countyBarsExpanded;
    const toggle = document.getElementById("county-bars-toggle");
    toggle.textContent = countyBarsExpanded ? "▼" : "▶";
    toggle.setAttribute("aria-label", countyBarsExpanded ? "收合" : "展開");
    document.getElementById("county-bars-container").innerHTML = countyBarsExpanded
      ? countyBarsExpandedHtml(geojson)
      : countyBarsHtml(geojson);
  });
}

// Groups districts by county and renders one horizontal segmented bar per
// county — segment width = that district's share of its county's total,
// segment color = colorForCount (same scale as the choropleth), bar length
// = county total relative to the largest county so rows stay comparable.
function countyBarsHtml(geojson) {
  const byCounty = new Map();
  for (const feature of geojson.features) {
    const { county, name, count } = feature.properties;
    if (!byCounty.has(county)) byCounty.set(county, []);
    byCounty.get(county).push({ name, count });
  }
  const entries = COUNTY_DISPLAY_ORDER.map((county) => {
    const districts = (byCounty.get(county) || []).slice().sort((a, b) => b.count - a.count);
    const total = districts.reduce((sum, d) => sum + d.count, 0);
    return { county, districts, total };
  });
  const maxTotal = Math.max(...entries.map((e) => e.total), 1);

  return entries
    .map(({ county, districts, total }) => {
      const barWidthPct = (total / maxTotal) * 100;
      const segments = districts
        .map((d) => {
          const widthPct = total > 0 ? (d.count / total) * 100 : 0;
          const color = colorForCount(d.count, maxCountRef);
          return (
            `<span class="county-bar-segment" style="width:${widthPct}%;background:${color};" ` +
            `title="${escapeHtml(d.name)}：${d.count} 人"></span>`
          );
        })
        .join("");
      return (
        `<div class="county-bar-row">` +
        `<div class="county-bar-label">${escapeHtml(county)}</div>` +
        `<div class="county-bar-track"><div class="county-bar-fill" style="width:${barWidthPct}%">${segments}</div></div>` +
        `<div class="county-bar-total">${total}</div>` +
        `</div>`
      );
    })
    .join("");
}

const MAX_DISTRICTS_PER_COUNTY = 10;

// Expanded view: one named row per district (top 10 by count, per county)
// instead of a single unlabeled stacked bar — bar length and color both
// scale against the global max so they read consistently with the map.
function countyBarsExpandedHtml(geojson) {
  const byCounty = new Map();
  for (const feature of geojson.features) {
    const { county, name, count } = feature.properties;
    if (!byCounty.has(county)) byCounty.set(county, []);
    byCounty.get(county).push({ name, count });
  }

  const groups = COUNTY_DISPLAY_ORDER.map((county) => {
    const allDistricts = byCounty.get(county) || [];
    const total = allDistricts.reduce((sum, d) => sum + d.count, 0);
    const withEmployees = allDistricts.filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
    const shown = withEmployees.slice(0, MAX_DISTRICTS_PER_COUNTY);
    const remaining = withEmployees.length - shown.length;

    const rows = shown
      .map((d) => {
        const widthPct = (d.count / maxCountRef) * 100;
        const color = colorForCount(d.count, maxCountRef);
        return (
          `<div class="district-bar-row">` +
          `<div class="district-bar-label">${escapeHtml(d.name)}</div>` +
          `<div class="district-bar-track"><div class="district-bar-fill" style="width:${widthPct}%;background:${color};"></div></div>` +
          `<div class="district-bar-count">${d.count}</div>` +
          `</div>`
        );
      })
      .join("");
    const moreNote =
      remaining > 0 ? `<div class="district-bar-more">還有 ${remaining} 個行政區未顯示</div>` : "";

    return (
      `<div class="county-expanded-group">` +
      `<div class="county-expanded-title">${escapeHtml(county)}<span class="county-expanded-total">共 ${total} 人</span></div>` +
      rows +
      moreNote +
      `</div>`
    );
  }).join("");

  return `<div class="county-bars-expanded-grid">${groups}</div>`;
}

// ---------------------------------------------------------------------
// Main tab switcher (地圖 / 裝修提案)
// ---------------------------------------------------------------------

document.querySelectorAll(".main-tab").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll(".main-tab").forEach((b) => b.classList.toggle("active", b === button));
    document.getElementById("tab-map").hidden = tab !== "map";
    document.getElementById("tab-renovation").hidden = tab !== "renovation";
    // Leaflet miscalculates its size if the container was display:none
    // while resized (e.g. the window changed size on the other tab).
    if (tab === "map" && mapRef) {
      requestAnimationFrame(() => mapRef.invalidateSize());
    }
  });
});

// ---------------------------------------------------------------------
// Renovation tab: space/meeting-room benchmark charts
// ---------------------------------------------------------------------

// 坪/employee at each company's HQ or largest known office site — see
// commit message / project notes for sources. These are estimates from
// news coverage and design-portfolio case studies, not official company
// disclosures (none of these companies publish this figure directly).
const SPACE_BENCHMARK_DATA = [
  { label: "Presco（現況）", value: 2.6, highlight: true },
  { label: "業界基準（低，JLL）", value: 3.7 },
  { label: "業界基準（高，CBRE）", value: 4.9 },
  { label: "NVIDIA", value: 6.4 },
  { label: "SAP", value: 7.3 },
  { label: "Google", value: 7.7 },
  { label: "Microsoft", value: 10.5 },
];

// Employees per meeting room — lower is more generously staffed. Atlassian
// and Meta figures are each from one specific (small) office, not a full
// HQ campus — noted in the surrounding copy, not fabricated averages.
const ROOM_BENCHMARK_DATA = [
  { label: "Presco（現況）", value: 25.6, highlight: true },
  { label: "NVIDIA（Endeavor）", value: 12.5 },
  { label: "Meta（Denver）*", value: 4.3, caveat: true },
];

function renderBenchmarkChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxValue = Math.max(...data.map((d) => d.value));
  container.innerHTML = data
    .map((d) => {
      const widthPct = (d.value / maxValue) * 100;
      const rowClass = d.highlight ? "benchmark-row benchmark-row-highlight" : "benchmark-row";
      return (
        `<div class="${rowClass}">` +
        `<div class="benchmark-label">${escapeHtml(d.label)}</div>` +
        `<div class="benchmark-track"><div class="benchmark-fill" style="width:${widthPct}%"></div></div>` +
        `<div class="benchmark-value">${d.value}${d.caveat ? "*" : ""}</div>` +
        `</div>`
      );
    })
    .join("");
}

renderBenchmarkChart("benchmark-space-chart", SPACE_BENCHMARK_DATA);
renderBenchmarkChart("benchmark-room-chart", ROOM_BENCHMARK_DATA);

initMap();
