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

let worldOffset = 0;

const mapShell = document.getElementById("map-shell");
const mapToggle = document.getElementById("map-toggle");

// click map preview to expand
mapShell.addEventListener("click", () => {
  if (mapShell.classList.contains("mini")) {
    mapShell.classList.remove("mini");
    mapShell.classList.add("full");

    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 500);
    }
  }
});

// click button to minimise
mapToggle.addEventListener("click", (e) => {
  e.stopPropagation();

  mapShell.classList.remove("full");
  mapShell.classList.add("mini");

  if (map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 500);
  }
});

// TICKS START

const ticks = document.getElementById("ticks");

const min = 0;
const max = 80;
const step = 5;

const cx = 150;
const cy = 150;
const rOuter = 105;
const rInner = 92;

// gauge spans roughly -120deg to +120deg
const startAngle = -210;
const endAngle = 30;

function degToRad(d) {
  return (d * Math.PI) / 180;
}

function initTicks() {

  for (let v = min; v <= max; v += step) {
    const t = (v - min) / (max - min);
    const angle = startAngle + t * (endAngle - startAngle);

    const a = degToRad(angle);

    const x1 = cx + Math.cos(a) * rInner;
    const y1 = cy + Math.sin(a) * rInner;

    const x2 = cx + Math.cos(a) * rOuter;
    const y2 = cy + Math.sin(a) * rOuter;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");

    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);

    line.setAttribute("stroke", "rgba(255,255,255,0.40)");
    line.setAttribute("stroke-width", v % 20 === 0 ? "2" : "1");

    ticks.appendChild(line);
  }
}
// TICKS END

function computeHeading(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function initMap() {
  if (!route.length) return;
  if (typeof L === "undefined") return;

  const first = route[0];

  map = L.map("map").setView(first, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    // attribution: "© OpenStreetMap"
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
  const signalIcon = L.divIcon({
    className: "signal-marker",
    html: `<div class="signal-dot"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });

  console.log("World loaded, route points:", route.length);
  if (USE_MAP) initMap();
  if (typeof L !== "undefined" && map) {
    for (const s of data.signals) {
      L.marker([s.lat, s.lon], { icon: signalIcon }).addTo(map);
    }
  }
  initTicks();
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

  // console.log(dist)

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
  // console.log(data)
  const distance = data?.distance ?? 9999;
  const mapEl = document.getElementById("map");
  const container = document.getElementById("container");
  const mapHud = document.getElementById("map-hud");

  // // ── VIEW SWITCHING ──
  // if (distance > 2000) {
  //   if (mapEl) mapEl.style.display = "block";
  //   if (container) container.style.display = "none";
  //   if (mapHud) mapHud.classList.add("visible");
  //   if (window._leafletMap) setTimeout(() => window._leafletMap.invalidateSize(), 50);
  // } else {
  //   if (mapEl) mapEl.style.display = "none";
  //   if (container) container.style.display = "block";
  //   if (mapHud) mapHud.classList.remove("visible");
  // }

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

  // ── OVERLAY GRADIENT (rectangle, repeating cycle) ──
  const amber = data?.amber_dur ?? 2;
  const redBefore = (data?.red_before_dur ?? 4) + 0.25 * amber;
  const green = (data?.green_dur ?? 8) + 0.5 * amber;
  const redAfter = (data?.red_after_dur ?? 4) + 0.25 * amber;
  const total = redBefore + green + redAfter;

  // build one full cycle as percentages within 0-100%
  const r1End   = (redBefore / total) * 100;
  const gStart  = r1End;
  const gEnd    = gStart + (green / total) * 100;
  const r2Start = gEnd;

  const overlayEl = document.getElementById("overlay");
  if (overlayEl) {
    // paint 3 full cycles stacked so scrolling always shows colour
    // each cycle = 33.33% of the 300% tall element
    const c = 33.333;
    const s = (pct) => pct / 3; // scale pct into one-third

    overlayEl.style.background = `linear-gradient(to bottom,
      #c21111        0%,
      #e68917        ${s(r1End * 0.6).toFixed(2)}%,
      #2c7d29        ${s(gStart).toFixed(2)}%,
      #2c7d29        ${s(gEnd).toFixed(2)}%,
      #e68917        ${s(r2Start + (100 - r2Start) * 0.4).toFixed(2)}%,
      #c21111        ${c.toFixed(2)}%,

      #c21111        ${c.toFixed(2)}%,
      #e68917        ${(c + s(r1End * 0.6)).toFixed(2)}%,
      #2c7d29        ${(c + s(gStart)).toFixed(2)}%,
      #2c7d29        ${(c + s(gEnd)).toFixed(2)}%,
      #e68917        ${(c + s(r2Start + (100 - r2Start) * 0.4)).toFixed(2)}%,
      #c21111        ${(2 * c).toFixed(2)}%,

      #c21111        ${(2 * c).toFixed(2)}%,
      #e68917        ${(2 * c + s(r1End * 0.6)).toFixed(2)}%,
      #2c7d29        ${(2 * c + s(gStart)).toFixed(2)}%,
      #2c7d29        ${(2 * c + s(gEnd)).toFixed(2)}%,
      #e68917        ${(2 * c + s(r2Start + (100 - r2Start) * 0.4)).toFixed(2)}%,
      #c21111        100%
    )`;
  }

  // ── OVERLAY POSITION — scroll rectangle so car sits at right phase ──
  const containerEl = document.getElementById("container");
  const delta = data?.delta_start;

  if (delta != null && containerEl && overlayEl) {
    const containerH = containerEl.clientHeight;
    // overlay is 300% tall = 3x containerH
    const overlayH = containerH * 3;
    // one cycle height in px
    const cycleH = overlayH / 3;

    const topBound    = -redBefore;
    const bottomBound = green + redAfter;
    const clamped     = Math.max(topBound, Math.min(delta, bottomBound));
    const ratio       = (clamped - topBound) / (bottomBound - topBound);

    // where in one cycle (px) does this ratio land?
    const posInCycle = ratio * cycleH;

    // car is fixed at 70% of containerH
    const carScreenY = containerH * 0.5;

    // top of overlay = carScreenY - posInCycle
    // start from middle cycle so there's room above and below
    const overlayTop = carScreenY - cycleH - posInCycle;

    overlayEl.style.top = `${overlayTop}px`;
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

  const speedBands = data?.speed_bands ?? [];
  const bgArc = document.getElementById("speed-arc-bg");
  const targetArc = document.getElementById("speed-arc-target");
  const needle = document.getElementById("needle");
  const readout = document.getElementById("speed-readout");
  const svg = document.getElementById("speedometer");

  // redraw bg arc (always full red)
  if (bgArc) {
      bgArc.setAttribute("d", describeArc(150, 150, 100, -120, 120));
      bgArc.setAttribute("stroke", "#c21111");
      bgArc.setAttribute("stroke-width", "14");
  }

  // remove old band arcs
  svg.querySelectorAll(".band-arc, .band-arc-amber").forEach(el => el.remove());

  // draw green + amber bands for each valid window
  const AMBER_MARGIN = 0.5; // mph of uncertainty either side

  speedBands.forEach(band => {
      const lo = band.lo;
      const hi = band.hi;
      const ab = 0.04737 * (hi - lo) + 0.10526

      // amber uncertainty margins
      const amberLo1 = Math.max(0, lo - ab);
      const amberHi2 = Math.min(80, hi + ab);

      // lower amber
      if (amberLo1 < lo) {
          const amberArcLo = document.createElementNS("http://www.w3.org/2000/svg", "path");
          amberArcLo.setAttribute("stroke-linecap", "butt");
          amberArcLo.setAttribute("d", describeArc(150, 150, 100, mphToAngle(amberLo1), mphToAngle(lo + ab / 2)));
          amberArcLo.setAttribute("stroke", "#e68917");
          amberArcLo.setAttribute("stroke-width", "14");
          amberArcLo.setAttribute("fill", "none");
          amberArcLo.setAttribute("stroke-linecap", "round");
          amberArcLo.classList.add("band-arc-amber");
          svg.insertBefore(amberArcLo, needle);
      }

      // upper amber
      if (amberHi2 > hi) {
        const amberArcHi = document.createElementNS("http://www.w3.org/2000/svg", "path");
        amberArcHi.setAttribute("d", describeArc(150, 150, 100, mphToAngle(hi - ab / 2), mphToAngle(amberHi2)));
        amberArcHi.setAttribute("stroke-linecap", "butt");
        amberArcHi.setAttribute("stroke", "#e68917");
        amberArcHi.setAttribute("stroke-width", "14");
        amberArcHi.setAttribute("fill", "none");
        amberArcHi.setAttribute("stroke-linecap", "round");
        amberArcHi.classList.add("band-arc-amber");
        svg.insertBefore(amberArcHi, needle);
      }

      // green band
      const greenArc = document.createElementNS("http://www.w3.org/2000/svg", "path");
      greenArc.setAttribute("d", describeArc(150, 150, 100, mphToAngle(lo + ab / 2), mphToAngle(hi - ab / 2)));
      greenArc.setAttribute("stroke", "#2c7d29");
      greenArc.setAttribute("stroke-width", "14");
      greenArc.setAttribute("fill", "none");
      greenArc.setAttribute("stroke-linecap", "round");
      greenArc.style.filter = "drop-shadow(0 0 6px rgba(79,255,176,0.6))";
      greenArc.classList.add("band-arc");
      svg.insertBefore(greenArc, needle);
  });

  // hide the old single target arc
  if (targetArc) targetArc.style.display = "none";

  if (needle) {
      needle.setAttribute("transform", `rotate(${mphToAngle(currentMph)} 150 150)`);
  }
  if (readout) {
      readout.textContent = `${Math.round(currentMph)} mph`;
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