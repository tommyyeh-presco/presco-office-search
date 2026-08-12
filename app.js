document.addEventListener("presco:authed", initMap, { once: true });

const LIGHT_RGB = [222, 235, 247]; // #deebf7
const DARK_RGB = [8, 48, 107];     // #08306b
const ZERO_COLOR = "#e9edf1";

function interpolateColor(t) {
  const rgb = LIGHT_RGB.map((c, i) => Math.round(c + (DARK_RGB[i] - c) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function colorForCount(count, maxCount) {
  if (count === 0) return ZERO_COLOR;
  return interpolateColor(count / maxCount);
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

  const layer = L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: colorForCount(feature.properties.count, maxCount),
      fillOpacity: 0.85,
      color: "#5b6b7a",
      weight: 1,
    }),
    onEachFeature: (feature, lyr) => {
      const { name, county, count } = feature.properties;
      lyr.bindTooltip(`${county}${name}：${count} 人`, { sticky: true });
      if (count > 0) {
        const center = lyr.getBounds().getCenter();
        L.marker(center, {
          icon: L.divIcon({
            className: "district-label",
            html: String(count),
            iconSize: [30, 16],
          }),
          interactive: false,
        }).addTo(map);
      }
    },
  }).addTo(map);

  // The map container is unhidden in the same tick as initMap() runs (the
  // password gate reveals #app right before dispatching the "presco:authed"
  // event). Leaflet can still measure a zero-size container at that exact
  // synchronous point, before the browser's next layout/paint pass — so
  // defer sizing to the next animation frame, once layout has settled.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(layer.getBounds());
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
