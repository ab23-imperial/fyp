import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "/login.html";
  }
});

onAuthStateChanged(auth, (user) => {
  const nameEl = document.getElementById("user-name");
  const greeting = document.getElementById("greeting");

  if (!nameEl || !greeting) return;

  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  nameEl.textContent = firstName || "driver";

  // reveal AFTER we set it
  greeting.classList.remove("loading");
});

let map;
let marker;
let startMarker;
let selectedLat = null;
let selectedLon = null;
let selectedName = null;
let selectedAddress = null;
let startLat = null;
let startLon = null;
let startName = null;

window.addEventListener("load", () => {
  initMap();
  initSearch();
  initStartSearch();
  initStart();
  initAvatar();
});

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
    selectedName = null;
    setMarker(e.latLng.lat(), e.latLng.lng());
  });
}

function initSearch() {
  const input = document.getElementById("search");
  const ac = new google.maps.places.Autocomplete(input);

  ac.addListener("place_changed", () => {
    const place = ac.getPlace();
    if (!place.geometry) return;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    selectedName = place.name || place.formatted_address || null;
    selectedAddress = place.formatted_address || null;

    map.panTo({ lat, lng });
    map.setZoom(15);
    setMarker(lat, lng);
  });
}

function initStartSearch() {
  const input = document.getElementById("search-start");
  const ac = new google.maps.places.Autocomplete(input);

  ac.addListener("place_changed", () => {
    const place = ac.getPlace();
    if (!place.geometry) return;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    startLat = lat;
    startLon = lng;
    startName = place.name || place.formatted_address || "Start";

    setStartMarker(lat, lng);

    const card = document.getElementById("start-card");
    const coords = document.getElementById("start-coords");
    if (card) card.classList.add("has-dest");
    if (coords) coords.textContent = startName;
  });
}

async function setStartMarker(lat, lon) {
  if (startMarker) startMarker.setMap(null);
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const pin = document.createElement("div");
  pin.style.cssText = "width:14px;height:14px;border-radius:50%;background:#4fffb0;border:2px solid #fff;box-shadow:0 0 8px rgba(79,255,176,0.7)";
  startMarker = new AdvancedMarkerElement({ map, position: { lat, lng: lon }, content: pin });
}

// in index.js, replace updateDestCard call in setMarker:
async function setMarker(lat, lon) {
  selectedLat = lat;
  selectedLon = lon;

  if (!selectedName) selectedName = "Pinned location";

  if (marker) marker.setMap(null);
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  marker = new AdvancedMarkerElement({ map, position: { lat, lng: lon } });

  // pass name directly instead of relying on shared variable
  const card = document.getElementById("dest-card");
  const coords = document.getElementById("dest-coords");
  if (card) card.classList.add("has-dest");
  if (coords) coords.textContent = selectedName;
}

function initStart() {
  document.getElementById("startBtn").onclick = start;
}

function getInitials(name) {
  if (!name) return "A";
  return name
    .trim()
    .split(/\s+/)
    .map(n => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function initAvatar() {
  const avatarBtn = document.getElementById("avatarBtn");
  const initialsEl = document.getElementById("avatarInitials");

  avatarBtn.onclick = async () => {
    await signOut(auth);
    window.location.href = "/login.html";
  };

  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    const initials = getInitials(user.displayName);
    initialsEl.textContent = initials;
  });
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
    if (startLat == null || startLon == null) { alert("Pick a start location first"); return; }
    start = [startLat, startLon];
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