let map;
let marker;
let selectedLat = null;
let selectedLon = null;

window.onload = () => {
  initMap();
  initSearch();
  initStart();
};

function getPhoneLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: pos.coords.speed || 10/3.6 // fallback
        });
      },
      reject,
      { enableHighAccuracy: true }
    );
  });
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 51.5023, lng: -0.1882 },
    zoom: 14,
    mapId: "547191cf7cef9aa0e24b218b"
  });

  map.addListener("click", (e) => {
    setMarker(e.latLng.lat(), e.latLng.lng());
  });
}

function initSearch() {
  const input = document.getElementById("search");

  const autocomplete = new google.maps.places.Autocomplete(input);

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();

    if (!place.geometry) return;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    map.panTo({ lat, lng });
    map.setZoom(15);

    setMarker(lat, lng);
  });
}

async function setMarker(lat, lon) {
  selectedLat = lat;
  selectedLon = lon;

  if (marker) marker.setMap(null);

  const { AdvancedMarkerElement } =
    await google.maps.importLibrary("marker");

  marker = new AdvancedMarkerElement({
    map,
    position: { lat: lat, lng: lon }
  });

}

function initStart() {
  document.getElementById("startBtn").onclick = start;
}

window.start = async function () {
  const mode = document.getElementById("mode").value;

  if (selectedLat == null || selectedLon == null) {
    alert("Pick a destination first");
    return;
  }

  let start;

  if (mode === "REAL") {
    const gps = await getPhoneLocation();
    start = [gps.lat, gps.lon];
  } else {
    start = [51.5023, -0.1882];
  }

  const res = await fetch("/init_route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start,
      end: [selectedLat, selectedLon]
    })
  });

  const data = await res.json();

  if (!data.route || !data.route.length) {
    alert("Route failed");
    return;
  }

  sessionStorage.setItem("mode", mode);
  window.location.href = "/drive";
};