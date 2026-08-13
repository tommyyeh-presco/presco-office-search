document.addEventListener("presco:authed", initMap, { once: true });

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
  const maxCount = Math.max(...geojson.features.map((f) => f.properties.count));

  const districtLayer = L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: colorForCount(feature.properties.count, maxCount),
      fillOpacity: FILL_OPACITY,
      color: borderColorForCount(feature.properties.count, maxCount),
      weight: borderWeightForCount(feature.properties.count, maxCount),
    }),
    onEachFeature: (feature, lyr) => {
      const { name, county, count } = feature.properties;
      lyr.bindTooltip(`${county}${name}：${count} 人`, { sticky: true });
      if (count > 0) {
        L.marker(labelLatLng(feature), {
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
      }
    },
  }).addTo(map);

  const taipeiBounds = await addCountyOutlines(map);
  addMrtLines(map);
  addOfficeMarker(map);

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
      `<div class="legend-scale"><span>0</span><span>${maxCount}</span></div>`;
    return div;
  };
  legend.addTo(map);
}
