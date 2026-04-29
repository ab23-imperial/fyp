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
  if (e.key === "s") SPEED = Math.max(1, SPEED - 1/3.6);
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
  const adviceMap = {
    arrive_before_green: ["ARRIVE BEFORE GREEN", "red"],
    arrive_during_green: ["ARRIVE DURING GREEN", "lime"],
    arrive_after_green: ["ARRIVE AFTER GREEN", "orange"],
    no_advice: ["NO DATA", "grey"]
  };

  const [text, colour] = adviceMap[data?.advice] || ["NO DATA", "grey"];

  const adviceEl = document.getElementById("advice");
  // if (adviceEl) {
  //   adviceEl.innerText = text;
  //   adviceEl.style.color = colour;
  // }

  // ---------------- DURATIONS ----------------
  const amber = data?.amber_dur ?? 2;
  const redBefore = (data?.red_before_dur ?? 4) + 0.25 * amber;
  const green = (data?.green_dur ?? 8) + 0.5 * amber;
  const redAfter = (data?.red_after_dur ?? 4) + 0.25 * amber;

  const total = redBefore + green + redAfter;

  // convert to %
  const redPct = (redBefore / total) * 100;
  const greenPct = (green / total) * 100;

  const greenStart = redPct;
  const greenEnd = redPct + greenPct;

  // ---------------- GRADIENT ----------------
  const overlay = document.getElementById("overlay");

  overlay.style.background = `
    linear-gradient(
      to bottom,
      red 0%,
      orange ${greenStart * 0.6}%,
      green ${greenStart}%,
      green ${greenEnd}%,
      orange ${greenEnd + (100 - greenEnd) * 0.4}%,
      red 100%
    )
  `;

  // ---------------- CAR POSITION ----------------
  const container = document.getElementById("container");
  const car = document.getElementById("car");

  const delta = data?.delta_start;

  if (delta !== null && delta !== undefined && container && car) {
    const topBound = -redBefore;
    const bottomBound = green + redAfter;

    const clamped = Math.max(topBound, Math.min(delta, bottomBound));
    const ratio = (clamped - topBound) / (bottomBound - topBound);

    const y = container.clientHeight * ratio;

    const carHeight = car.clientHeight || 100; // fallback
    car.style.top = `${y - carHeight / 2}px`;
  }

  const textEl = document.getElementById("text");
  if (textEl && data?.distance != null && data?.eta != null) {
    const currentMph = data?.current_speed_mph ?? (SPEED * 2.23694);
    textEl.innerText =
      `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(0)}s | ${currentMph.toFixed(0)} mph`;

    const target = data?.target_speed_mph;

    const targetEl = document.getElementById("advice");

    if (targetEl && target != null) {
      const diff = target - currentMph;

      let label = "";
      let colour = "white";

      if (Math.abs(diff) < 1) {
        label = `HOLD\n${target.toFixed(0)} mph`;
        colour = "white";
      } else if (diff > 0) {
        label = `↑ SPEED UP\n${target.toFixed(0)} mph`;
        colour = "orange";
      } else {
        label = `↓ SLOW DOWN\n${target.toFixed(0)} mph`;
        colour = "cyan";
      }

      targetEl.innerText = label;
      targetEl.style.color = colour;
    }
  }

  const signalEl = document.getElementById("signal-status");
  if (signalEl && data?.phase) {
    const map = { green: "🟢", amber: "🟠", red: "🔴", unknown: "⚪" };
    signalEl.innerText = `${map[data.phase] || "⚪"} ${data.signal_id ?? ""}`;
  }

  const distance = data?.distance ?? 9999;
  const mapEl = document.getElementById("map");

  if (distance > 200) {
    if (mapEl) mapEl.style.display = "block";
    if (container) container.style.display = "none";
  
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 50);
    }
  } else {
    // NEAR → show signal UI
    if (mapEl) mapEl.style.display = "none";
    if (container) container.style.display = "block";
  }
}

window.onload = async () => {
  try {
    if (MODE === "REAL") {
      await initFromGPS();
    } else {
      await initWorld();
    }

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
};
