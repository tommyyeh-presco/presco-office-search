document.addEventListener("presco:authed", initMap, { once: true });

const LIGHT_RGB = [222, 235, 247]; // #deebf7
const DARK_RGB = [8, 48, 107];     // #08306b
const ZERO_BORDER_COLOR = "#b7c2cd";
const FILL_COLOR = "#eef3f8";
const FILL_OPACITY = 0.15;
const COUNTY_BORDER_COLOR = "#22303f";

function interpolateColor(t) {
  const rgb = LIGHT_RGB.map((c, i) => Math.round(c + (DARK_RGB[i] - c) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
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
}

async function initMap() {
  const map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  const response = await fetch("data/districts.geo.json");
  const geojson = await response.json();
  const maxCount = Math.max(...geojson.features.map((f) => f.properties.count));

  const districtLayer = L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: FILL_COLOR,
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
            iconSize: [70, 34],
            iconAnchor: [35, 34],
          }),
          interactive: false,
        }).addTo(map);
      }
    },
  }).addTo(map);

  addCountyOutlines(map);

  // The map container is unhidden in the same tick as initMap() runs (the
  // password gate reveals #app right before dispatching the "presco:authed"
  // event). Leaflet can still measure a zero-size container at that exact
  // synchronous point, before the browser's next layout/paint pass — so
  // defer sizing to the next animation frame, once layout has settled.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(districtLayer.getBounds());
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
