let userLat = null;
let userLon = null;
let nearestLine = null;
let nearestLabel = null;

// Initialise map
const map = L.map("map").setView([51.5074, -0.1278], 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Get user location
navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLon = pos.coords.longitude;

  map.setView([userLat, userLon], 16);

  var blue_dot_icon = L.icon({
    iconUrl: '/images/blue_dot.png',

    iconSize:     [50, 50], // size of the icon
  });

  const userMarker = L.marker([userLat, userLon], {
    icon : blue_dot_icon,
    interactive: false
  }).addTo(map);

  fetchTrafficLights(userLat, userLon);
});

// Overpass query
function fetchTrafficLights(lat, lon) {
  const radius = 500;

  const query = `
    [out:json];
    node["highway"="traffic_signals"](around:${radius},${lat},${lon});
    out body;
  `;

  fetch("https://overpass.kumi.systems/api/interpreter", {
    method: "POST",
    body: query
  })
  .then(async res => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Overpass error ${res.status}: ${text.slice(0, 100)}`);
    }
    return res.json();
  })
  .then(data => handleTrafficLights(data.elements))
  .catch(err => {
    console.error(err.message);
    alert("Overpass API busy, try again in a few seconds");
  });

}

// Handle results
function handleTrafficLights(lights) {
  let nearest = null;
  let nearestDist = Infinity;

  lights.forEach(light => {
    const dist = haversine(
      userLat,
      userLon,
      light.lat,
      light.lon
    );

    // Highlight all traffic lights
    L.circleMarker([light.lat, light.lon], {
      radius: 6,
      color: "orange",
      fillOpacity: 0.8
    })
      .addTo(map)
      .bindPopup(`Traffic light<br>${dist.toFixed(1)} m`);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = light;
    }
  });

  if (nearest) {
    drawNearest(nearest, nearestDist);
  }
}

// Draw line + label
function drawNearest(light, dist) {
  const from = [userLat, userLon];
  const to = [light.lat, light.lon];

  nearestLine = L.polyline([from, to], {
    weight: 3,
    dashArray: "6 6"
  }).addTo(map);

  const mid = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2
  ];

  nearestLabel = L.marker(mid, {
    icon: L.divIcon({
      className: "",
      html: `<div class="distance-label">${dist.toFixed(1)} m</div>`
    }),
    interactive: false
  }).addTo(map);
}

// Haversine distance in metres
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
