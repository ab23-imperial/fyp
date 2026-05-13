import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "/login.html";
  }
});

let MODE = "SIM";

function toggleMode() {
  MODE = MODE === "SIM" ? "REAL" : "SIM";
  console.log("Mode:", MODE);
}

let lat = 0;
let lon = 0;

let route = [];
let routeIndex = 0;

let KMH = 10;
let SPEED = KMH/3.6;
let running = true;

let prevLat = null;
let prevLon = null;
let prevTime = null;
let smoothSpeed = 0;

const ARRIVAL_THRESHOLD = 6;

const USE_MAP = typeof L !== "undefined";

let lastTime = performance.now();

let map, routeLine, marker;

function initMap() {
  if (!route.length) return;
  if (typeof L === "undefined") return;

  const first = route[0];

  map = L.map("map").setView(first, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);

  // draw route
  routeLine = L.polyline(route, {color: "blue"}).addTo(map);

  // marker for you
  marker = L.marker(first).addTo(map);
}

async function initWorld() {
  const res = await fetch("/init");
  const data = await res.json();

  route = data.route || [];

  if (!route.length) {
    console.error("No route received");
    return;
  }

  routeIndex = 0;
  [lat, lon] = route[0];

  console.log("World loaded, route points:", route.length);
  if (USE_MAP) initMap();
  if (typeof L !== "undefined" && map) {
    for (const s of data.signals) {
      L.circleMarker([s.lat, s.lon], {
        radius: 5,
        color: "red"
      }).addTo(map);
    }
  }
}

async function initRoute(start, end) {
  const res = await fetch("/init_route", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ start, end })
  });

  const data = await res.json();

  route = data.route || [];

  if (!route.length) {
    console.error("No route received");
    return;
  }

  // ✅ SAME AS initWorld
  routeIndex = 0;
  [lat, lon] = route[0];

  console.log("Route loaded, points:", route.length);

  // ✅ map setup
  if (USE_MAP) initMap();

  if (typeof L !== "undefined" && map) {
    for (const s of data.signals) {
      L.circleMarker([s.lat, s.lon], {
        radius: 5,
        color: "red"
      }).addTo(map);
    }
  }
}

async function initFromGPS(endLat, endLon) {
  const gps = await getPhoneLocation();

  const res = await fetch("/init_from_gps", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      lat: gps.lat,
      lon: gps.lon,
      end: [endLat, endLon]
    })
  });

  const data = await res.json();
  route = data.route;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "w") SPEED += 1/3.6;
  if (e.key === "s") SPEED = Math.max(0.1, SPEED - 1/3.6);
  console.log("Speed:", SPEED);
});

function getPhoneLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speed: pos.coords.speed || SPEED // fallback
        });
      },
      reject,
      { enableHighAccuracy: true }
    );
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function moveTowards(targetLat, targetLon, speed, dt) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const toDeg = x => x * 180 / Math.PI;

  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = toRad(targetLat);
  const lon2 = toRad(targetLon);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) ** 2;

  const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  console.log(dist)

  if (dist < 0.5) return;

  const moveDist = Math.min(speed * dt, dist);
  const ratio = moveDist / dist;

  lat = toDeg(lat1 + dLat * ratio);
  lon = toDeg(lon1 + dLon * ratio);
}

function updateRouteProgress() {
  if (routeIndex >= route.length - 1) return;

  const [tx, ty] = route[routeIndex];
  const dist = haversine(lat, lon, tx, ty);

  if (dist < ARRIVAL_THRESHOLD) {
    routeIndex++;
    console.log("route →", routeIndex);
  }
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;

  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);

  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    "M", start.x, start.y,
    "A", r, r, 0, largeArcFlag, 0, end.x, end.y
  ].join(" ");
}

function mphToAngle(mph) {
  return -120 + (mph / 80) * 240;
}

async function loop() {
  if (!running) return;

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  try {
    let payload = {};

    if (MODE === "SIM") {
      const target = route[routeIndex];
      if (!target) return;

      moveTowards(target[0], target[1], SPEED, dt);
      updateRouteProgress();

      payload = {
        lat,
        lon,
        speed: SPEED,
        route_idx: routeIndex
      };

    } else {
      const gps = await getPhoneLocation();

      const now = performance.now();

      let computedSpeed = SPEED;

      if (prevLat !== null) {
        const dist = haversine(prevLat, prevLon, gps.lat, gps.lon);
        const dt = (now - prevTime) / 1000;

        if (dt > 0) {
          computedSpeed = dist / dt;
        }
      }

      // smooth it
      smoothSpeed = 0.7 * smoothSpeed + 0.3 * computedSpeed;

      // update history
      prevLat = gps.lat;
      prevLon = gps.lon;
      prevTime = now;

      lat = gps.lat;
      lon = gps.lon;

      payload = {
        lat,
        lon,
        speed: smoothSpeed, // ✅ use your computed value
        route_idx: null
      };
    }

    const res = await fetch("/gps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    updateUI(data);

    if (marker) {
      marker.setLatLng([lat, lon]);
    }
    if (USE_MAP && map) {
      map.panTo([lat, lon]);
    }

  } catch (err) {
    console.error("loop error:", err);
    running = false;
  }

  setTimeout(loop, 200);
}

function updateUI(data) {
  const distance = data?.distance ?? 9999;
  const mapEl = document.getElementById("map");
  const container = document.getElementById("container");
  const mapHud = document.getElementById("map-hud");

  // ── VIEW SWITCHING ──
  if (distance > 2000) {
    if (mapEl) mapEl.style.display = "block";
    if (container) container.style.display = "none";
    if (mapHud) mapHud.classList.add("visible");
    if (window._leafletMap) setTimeout(() => window._leafletMap.invalidateSize(), 50);
  } else {
    if (mapEl) mapEl.style.display = "none";
    if (container) container.style.display = "block";
    if (mapHud) mapHud.classList.remove("visible");
  }

  // ── SIGNAL DOT ──
  const phase = data?.phase;
  const dot = document.getElementById("signal-dot");
  const label = document.getElementById("signal-label");
  const phaseNames = { green: "Green", amber: "Amber", red: "Red" };
  if (dot && phase) {
    dot.className = phase;
    if (label) label.textContent = phaseNames[phase] || "—";
  }

  // map signal dot
  const mapDot = document.getElementById("map-signal-dot");
  const phaseColors = { green: "#4fffb0", amber: "#f59e0b", red: "#ef4444" };
  if (mapDot && phase) mapDot.style.background = phaseColors[phase] || "#888";

  // ── OVERLAY GRADIENT ──
  const amber = data?.amber_dur ?? 2;
  const redBefore = (data?.red_before_dur ?? 4) + 0.25 * amber;
  const green = (data?.green_dur ?? 8) + 0.5 * amber;
  const redAfter = (data?.red_after_dur ?? 4) + 0.25 * amber;
  const total = redBefore + green + redAfter;
  const redPct = (redBefore / total) * 100;
  const greenPct = (green / total) * 100;
  const greenStart = redPct;
  const greenEnd = redPct + greenPct;

  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.style.background = `linear-gradient(to bottom,
      #c21111 0%,
      #e68917 ${(greenStart * 0.6).toFixed(1)}%,
      #2c7d29 ${greenStart.toFixed(1)}%,
      #2c7d29 ${greenEnd.toFixed(1)}%,
      #e68917 ${(greenEnd + (100 - greenEnd) * 0.4).toFixed(1)}%,
      #c21111 100%
    )`;
  }

  // ── CAR POSITION ──
  const containerEl = document.getElementById("container");
  const car = document.getElementById("car");
  const delta = data?.delta_start;
  if (delta != null && containerEl && car) {
    const topBound = -redBefore;
    const bottomBound = green + redAfter;
    const clamped = Math.max(topBound, Math.min(delta, bottomBound));
    const ratio = (clamped - topBound) / (bottomBound - topBound);
    const y = containerEl.clientHeight * ratio;
    car.style.top = `${y - (car.clientHeight || 80) / 2}px`;
  }

  // ── ADVICE ──
  const target = data?.target_speed_mph;
  const currentMph = data?.current_speed_mph ?? 0;
  const adviceEl = document.getElementById("advice");
  const adviceSub = document.getElementById("advice-sub");
  const adviceCard = document.getElementById("advice-card");

  if (adviceEl && target != null) {
    const diff = target - currentMph;
    if (Math.abs(diff) < 1) {
      adviceEl.textContent = `${Math.round(target)} mph`;
      adviceEl.className = "hold";
      if (adviceSub) adviceSub.textContent = "Hold speed";
      if (adviceCard) adviceCard.className = "hold";
    } else if (diff > 0) {
      adviceEl.textContent = `↑ ${Math.round(target)} mph`;
      adviceEl.className = "up";
      if (adviceSub) adviceSub.textContent = "Speed up";
      if (adviceCard) adviceCard.className = "up";
    } else {
      adviceEl.textContent = `↓ ${Math.round(target)} mph`;
      adviceEl.className = "down";
      if (adviceSub) adviceSub.textContent = "Slow down";
      if (adviceCard) adviceCard.className = "down";
    }
  } else if (adviceEl) {
    adviceEl.textContent = "—";
    adviceEl.className = "hold";
    if (adviceSub) adviceSub.textContent = "No data";
  }

  // map advice
  const mapAdvice = document.getElementById("map-advice");
  const mapText = document.getElementById("map-text");
  if (mapAdvice && adviceEl) {
    mapAdvice.textContent = adviceEl.textContent;
    mapAdvice.style.color = adviceEl.className === "up" ? "#f59e0b"
      : adviceEl.className === "down" ? "#4fffb0" : "#f0f0f0";
  }

  // ── CHIPS ──
  const distVal = document.getElementById("dist-val");
  const etaVal = document.getElementById("eta-val");
  const speedVal = document.getElementById("speed-val");
  if (distVal && data?.distance != null) distVal.textContent = Math.round(data.distance);
  if (etaVal && data?.eta != null) etaVal.textContent = Math.round(data.eta);
  if (speedVal) speedVal.textContent = Math.round(currentMph);
  if (mapText && data?.distance != null) {
    mapText.textContent = `${Math.round(data.distance)}m away · ETA ${Math.round(data?.eta ?? 0)}s`;
  }

  // Formula: Faster speed = Lower duration.
  // We use 0.1s as a minimum so it doesn't break at high speeds.
  const duration = Math.max(0.1, 4 - (Math.min(currentMph, 80) / 80) * 3.8);

  const road = document.getElementById("road");
  if (road) {
    // Set the variable directly on the road element
    road.style.setProperty("--road-speed", `${duration}s`);
  }

  const band = data?.speed_band;
  const current = data?.current_speed_mph ?? 0;

  const bgArc = document.getElementById("speed-arc-bg");
  const targetArc = document.getElementById("speed-arc-target");
  const needle = document.getElementById("needle");
  const readout = document.getElementById("speed-readout");

  if (bgArc) {
    bgArc.setAttribute(
      "d",
      describeArc(150, 150, 100, -120, 120)
    );
  }

  if (band && targetArc) {
    targetArc.setAttribute(
      "d",
      describeArc(
        150,
        150,
        100,
        mphToAngle(band.min),
        mphToAngle(band.max)
      )
    );
  }

  if (needle) {
    const angle = mphToAngle(current);

    needle.setAttribute(
      "transform",
      `rotate(${angle} 150 150)`
    );
  }

  if (readout) {
    readout.textContent = `${Math.round(current)} mph`;
  }
};


window.addEventListener("load", async () => {
  try {
    await initWorld();
    // if (MODE === "REAL") {
    //   const gps = await getPhoneLocation();
    //   await initRoute(
    //     [gps.lat, gps.lon],
    //     [51.5033, -0.1533]   // temp hardcoded destination
    //   );
    // } else {
    //   await initRoute(
    //     [51.5023, -0.1882],   // hardcode for now
    //     [51.5033, -0.1533]
    //   );
    // }

    if (!route.length) {
      document.getElementById("advice").innerText = "Init failed";
      alert(`why: ${route.length}`);
      return;
    }

    loop();

  } catch (e) {
    console.error("INIT FAILED:", e);
    alert(`Init failed: ${e.message || e}`);
  }
});