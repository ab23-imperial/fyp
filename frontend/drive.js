import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "/login.html";
  }
});

// ── MODE ──────────────────────────────────────────────────────────────────────
let MODE = sessionStorage.getItem("mode") || "SIM";

// ── STATE ─────────────────────────────────────────────────────────────────────
let lat = 0;
let lon = 0;

let route = [];
let signals = [];
let routeIndex = 0;

let KMH = 10;
let SPEED = KMH / 3.6;
let running = true;

let prevLat = null;
let prevLon = null;
let prevTime = null;
let smoothSpeed = 0;

const ARRIVAL_THRESHOLD = 6;

const USE_MAP = typeof L !== "undefined";

let lastTime = performance.now();

let map, marker, routeLayer;
let currentBearing = 0;

let cameraVideo = null;
let cameraCanvas = null;
let cameraCtx = null;
let cameraActive = false;
let lastFrameTime = 0;

// ── MAP TOGGLE — tap thumbnail to expand, tap button to minimise ──────────────
const mapShell  = document.getElementById("map-shell");
const mapToggle = document.getElementById("map-toggle");

mapShell.addEventListener("click", () => {
  if (mapShell.classList.contains("mini")) {
    mapShell.classList.remove("mini");
    mapShell.classList.add("full");
    if (map) setTimeout(() => { map.invalidateSize(); map.setZoom(18); }, 500);
  }
});

mapToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  mapShell.classList.remove("full");
  mapShell.classList.add("mini");
  if (map) setTimeout(() => { map.invalidateSize(); map.setZoom(16); }, 500);
});


// ── SPEEDOMETER GEOMETRY ──────────────────────────────────────────────────────
const ticks = document.getElementById("ticks");

const min = 0;
const max = 80;
const step = 5;

const cx = 150;
const cy = 150;
const rOuter = 105;
const rInner = 92;

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

// ── MAP ───────────────────────────────────────────────────────────────────────
function initMap() {
  if (!route.length) return;
  if (typeof L === "undefined") return;

  const first = route[0];

  map = L.map("map", { zoomControl: false, attributionControl: false }).setView(first, 16);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  // Route line (placeholder — will be replaced by colorRoute each tick)
  routeLayer = L.layerGroup().addTo(map);

  // Car marker — arrow points in direction of travel
  const carIcon = L.divIcon({
    className: "",
    html: `<div class="car-dot"><svg width="16" height="22" viewBox="0 0 16 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 0 L16 17 L8 12 L0 17 Z" fill="white" opacity="0.95"/><circle cx="8" cy="13" r="3.5" fill="#4fffb0"/></svg></div>`,
    iconSize: [16, 22],
    iconAnchor: [8, 13],
  });
  marker = L.marker(first, { icon: carIcon }).addTo(map);
}

// ── BEARING ───────────────────────────────────────────────────────────────────

function computeBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smooths toward target along the shortest arc (~0.2 per tick at 5 Hz ≈ 1 s time-constant)
function smoothBearing(current, target) {
  const diff = ((target - current + 540) % 360) - 180;
  return (current + diff * 0.2 + 360) % 360;
}

// ── CAMERA ───────────────────────────────────────────────────────────────────
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 320 }, height: { ideal: 240 } }
    });
    cameraVideo = document.createElement("video");
    cameraVideo.srcObject = stream;
    cameraVideo.setAttribute("playsinline", "");
    cameraVideo.muted = true;
    await cameraVideo.play();
    cameraCanvas = document.createElement("canvas");
    cameraCanvas.width = 320;
    cameraCanvas.height = 240;
    cameraCtx = cameraCanvas.getContext("2d");
    cameraActive = true;
    console.log("Camera ready — vision active");
  } catch (e) {
    console.log("No camera available:", e.message);
  }
}

function captureFrame() {
  if (!cameraActive || !cameraVideo || !cameraVideo.videoWidth) return null;
  cameraCtx.drawImage(cameraVideo, 0, 0, 320, 240);
  return cameraCanvas.toDataURL("image/jpeg", 0.6).split(",")[1];
}

// ── PHASE COLOURING ───────────────────────────────────────────────────────────

/**
 * Returns "green" | "amber" | "red" for a signal cycle position of
 * (t_mod_now + eta) seconds from the top of the cycle.
 */
function phaseAt(t_mod_now, eta, g, a, r) {
  const cycle = g + a + r;
  const t = ((t_mod_now + eta) % cycle + cycle) % cycle;
  if (t < g) return "green";
  if (t < g + a) return "amber";
  return "red";
}

// Matches the speedometer arc and original overlay palette exactly
const PHASE_COLORS = {
  green: "#2c7d29",
  amber: "#e68917",
  red:   "#c21111",
};

/**
 * Redraws the route on the Leaflet map.
 *
 * The entire stretch from the car to the next signal is drawn as one colour:
 * the phase the signal will be in when the car arrives at current speed.
 * "My road is green right now" = I'm on track to arrive on green.
 *
 *   • Already passed  → dim white, thin
 *   • Car → signal    → one solid colour (green / amber / red)
 *   • Beyond signal   → dim white, medium
 */
function colorRoute(data) {
  if (!map || !route.length || !routeLayer) return;

  routeLayer.clearLayers();

  const { t_mod, green_dur: g, amber_dur: a, red_dur: r, signal_route_idx, eta } = data;

  if (t_mod == null || !g || eta == null) return;

  const signalIdx = signal_route_idx != null
    ? Math.min(signal_route_idx, route.length - 1)
    : route.length - 1;

  // ── Already-passed portion ──────────────────────────────────────────────
  if (routeIndex > 0) {
    L.polyline(route.slice(0, routeIndex + 1), {
      color: "rgba(255,255,255,0.13)",
      weight: 3,
      interactive: false,
    }).addTo(routeLayer);
  }

  // ── Active portion: one colour = arrival phase at current speed ──────────
  const arrivalPhase = phaseAt(t_mod, eta, g, a, r);
  const activePts = [[lat, lon], ...route.slice(routeIndex, signalIdx + 1)];

  if (activePts.length >= 2) {
    L.polyline(activePts, {
      color: PHASE_COLORS[arrivalPhase],
      weight: 8,
      opacity: 0.95,
      className: `phase-${arrivalPhase}`,
      interactive: false,
    }).addTo(routeLayer);
  }

  // ── Beyond-signal portion ─────────────────────────────────────────────────
  if (signalIdx < route.length - 1) {
    L.polyline(route.slice(signalIdx), {
      color: "rgba(255,255,255,0.18)",
      weight: 4,
      interactive: false,
    }).addTo(routeLayer);
  }
}

// ── GEO HELPERS ───────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
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
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (dist < 0.5) return;

  const moveDist = Math.min(speed * dt, dist);
  const ratio = moveDist / dist;

  lat = toDeg(lat1 + dLat * ratio);
  lon = toDeg(lon1 + dLon * ratio);
}

function updateRouteProgress() {
  if (routeIndex >= route.length - 1) return;
  const [tx, ty] = route[routeIndex];
  if (haversine(lat, lon, tx, ty) < ARRIVAL_THRESHOLD) {
    routeIndex++;
    console.log("route →", routeIndex);
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function initWorld() {
  const res = await fetch("/init");
  const data = await res.json();

  route = data.route || [];
  signals = data.signals || [];

  if (!route.length) {
    console.error("No route received");
    return;
  }

  routeIndex = 0;
  [lat, lon] = route[0];

  if (USE_MAP) {
    initMap();

    // Signal markers
    const sigIcon = L.divIcon({
      className: "",
      html: `<div class="signal-marker-dot"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });
    for (const s of signals) {
      L.marker([s.lat, s.lon], { icon: sigIcon }).addTo(map);
    }
  }

  initTicks();
}

// ── KEYBOARD SPEED CONTROL ────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.key === "w") SPEED += 1 / 3.6;
  if (e.key === "s") SPEED = Math.max(0.1, SPEED - 1 / 3.6);
});

// ── SIM TOUCH SPEED CONTROL ───────────────────────────────────────────────────
window.simSpeedChange = function(delta) {
  SPEED = Math.max(0.1, SPEED + delta * (1 / 3.6));
};

// Hide controls in REAL mode
if (MODE !== "SIM") {
  const ctrl = document.getElementById("sim-speed-controls");
  if (ctrl) ctrl.style.display = "none";
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function getPhoneLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat:     pos.coords.latitude,
        lon:     pos.coords.longitude,
        speed:   pos.coords.speed || SPEED,
        heading: pos.coords.heading,
      }),
      reject,
      { enableHighAccuracy: true }
    );
  });
}

// ── SPEEDOMETER HELPERS ───────────────────────────────────────────────────────
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end   = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return ["M", start.x, start.y, "A", r, r, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}

function mphToAngle(mph) {
  return -120 + (mph / 80) * 240;
}

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────
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

      // Bearing = direction toward the current waypoint target
      const rawBearing = computeBearing(lat, lon, target[0], target[1]);
      currentBearing = smoothBearing(currentBearing, rawBearing);

      payload = { lat, lon, speed: SPEED, route_idx: routeIndex };

    } else {
      const gps = await getPhoneLocation();
      const nowMs = performance.now();
      let computedSpeed = SPEED;

      if (prevLat !== null) {
        const dist = haversine(prevLat, prevLon, gps.lat, gps.lon);
        const elapsed = (nowMs - prevTime) / 1000;
        if (elapsed > 0) computedSpeed = dist / elapsed;
      }

      smoothSpeed = 0.7 * smoothSpeed + 0.3 * computedSpeed;

      // Use GPS heading when available, otherwise derive from position delta
      if (gps.heading != null && !isNaN(gps.heading)) {
        currentBearing = smoothBearing(currentBearing, gps.heading);
      } else if (prevLat !== null) {
        const rawBearing = computeBearing(prevLat, prevLon, gps.lat, gps.lon);
        currentBearing = smoothBearing(currentBearing, rawBearing);
      }

      prevLat = gps.lat;
      prevLon = gps.lon;
      prevTime = nowMs;
      lat = gps.lat;
      lon = gps.lon;

      payload = { lat, lon, speed: smoothSpeed, route_idx: null };
    }

    // Attach camera frame once per second for server-side vision detection
    const frameB64 = (cameraActive && now - lastFrameTime > 1000)
      ? (lastFrameTime = now, captureFrame())
      : null;
    if (frameB64) payload.frame_b64 = frameB64;

    const res = await fetch("/gps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    updateUI(data);

    if (marker) {
      marker.setLatLng([lat, lon]);
      // Rotate arrow to face direction of travel
      const markerEl = marker.getElement();
      if (markerEl) {
        const dot = markerEl.querySelector(".car-dot");
        if (dot) dot.style.transform = `rotate(${currentBearing}deg)`;
      }
    }
    if (USE_MAP && map) {
      if (mapShell.classList.contains("full")) {
        // Pan slightly ahead so road ahead fills the view (north-up, no tile rotation issues)
        const lookM = 80;
        const bearRad = currentBearing * Math.PI / 180;
        const R = 6371000;
        const dLat = (lookM * Math.cos(bearRad)) / R * (180 / Math.PI);
        const dLon = (lookM * Math.sin(bearRad)) / (R * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);
        map.panTo([lat + dLat, lon + dLon], { animate: true, duration: 0.2, noMoveStart: true });
      } else {
        map.panTo([lat, lon]);
      }
    }

  } catch (err) {
    console.error("loop error:", err);
    running = false;
  }

  setTimeout(loop, 200);
}

// ── UI UPDATE ─────────────────────────────────────────────────────────────────
function updateUI(data) {
  const currentMph = data?.current_speed_mph ?? 0;

  // ── Speedometer ──
  const speedBands = data?.speed_bands ?? [];
  const bgArc   = document.getElementById("speed-arc-bg");
  const targetArc = document.getElementById("speed-arc-target");
  const needle  = document.getElementById("needle");
  const readout = document.getElementById("speed-readout");
  const svg     = document.getElementById("speedometer");

  if (bgArc) {
    bgArc.setAttribute("d", describeArc(150, 150, 100, -120, 120));
    bgArc.setAttribute("stroke", "#c21111");
    bgArc.setAttribute("stroke-width", "14");
  }

  svg.querySelectorAll(".band-arc, .band-arc-amber").forEach(el => el.remove());

  speedBands.forEach(band => {
    const lo = band.lo;
    const hi = band.hi;
    const ab = 0.04737 * (hi - lo) + 0.10526;

    const amberLo1 = Math.max(0, lo - ab);
    const amberHi2 = Math.min(80, hi + ab);

    if (amberLo1 < lo) {
      const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arc.setAttribute("stroke-linecap", "butt");
      arc.setAttribute("d", describeArc(150, 150, 100, mphToAngle(amberLo1), mphToAngle(lo + ab / 2)));
      arc.setAttribute("stroke", "#e68917");
      arc.setAttribute("stroke-width", "14");
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke-linecap", "round");
      arc.classList.add("band-arc-amber");
      svg.insertBefore(arc, needle);
    }

    if (amberHi2 > hi) {
      const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arc.setAttribute("d", describeArc(150, 150, 100, mphToAngle(hi - ab / 2), mphToAngle(amberHi2)));
      arc.setAttribute("stroke-linecap", "butt");
      arc.setAttribute("stroke", "#e68917");
      arc.setAttribute("stroke-width", "14");
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke-linecap", "round");
      arc.classList.add("band-arc-amber");
      svg.insertBefore(arc, needle);
    }

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

  if (targetArc) targetArc.style.display = "none";

  if (needle)  needle.setAttribute("transform", `rotate(${mphToAngle(currentMph)} 150 150)`);
  if (readout) readout.textContent = `${Math.round(currentMph)} mph`;

  // ── Overlay gradient ──
  const amber_dur   = data?.amber_dur ?? 2;
  const redBefore   = (data?.red_before_dur ?? 4) + 0.25 * amber_dur;
  const greenDur    = (data?.green_dur ?? 8) + 0.5 * amber_dur;
  const redAfter    = (data?.red_after_dur ?? 4) + 0.25 * amber_dur;
  const total       = redBefore + greenDur + redAfter;
  const r1End       = (redBefore / total) * 100;
  const gStart      = r1End;
  const gEnd        = gStart + (greenDur / total) * 100;
  const r2Start     = gEnd;

  const overlayEl   = document.getElementById("overlay");
  if (overlayEl) {
    const c = 33.333;
    const s = (pct) => pct / 3;
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

  // ── Overlay position — scroll so car sits at correct phase colour ──
  const containerEl = document.getElementById("container");
  const delta = data?.delta_start;
  if (delta != null && containerEl && overlayEl) {
    const containerH = containerEl.clientHeight;
    const cycleH     = containerH;
    const topBound    = -redBefore;
    const bottomBound = greenDur + redAfter;
    const clamped     = Math.max(topBound, Math.min(delta, bottomBound));
    const ratio       = (clamped - topBound) / (bottomBound - topBound);
    const posInCycle  = ratio * cycleH;
    const carScreenY  = containerH * 0.5;
    const overlayTop  = carScreenY - cycleH - posInCycle;
    overlayEl.style.top = `${overlayTop}px`;
  }

  // ── Road animation speed ──
  const road = document.getElementById("road");
  if (road) {
    const duration = Math.max(0.1, 4 - (Math.min(currentMph, 80) / 80) * 3.8);
    road.style.setProperty("--road-speed", `${duration}s`);
  }

  // ── Distance pill ──
  const distVal = document.getElementById("dist-val");
  if (distVal && data?.distance != null) distVal.textContent = Math.round(data.distance);

  // ── Map HUD mirrors ──
  const mapDot    = document.getElementById("map-signal-dot");
  const mapAdvice = document.getElementById("map-advice");
  const mapText   = document.getElementById("map-text");
  const phase     = data?.phase;
  const phaseColors = { green: "#4fffb0", amber: "#f59e0b", red: "#ef4444" };
  if (mapDot && phase) mapDot.style.background = phaseColors[phase] || "#888";
  const target_speed = data?.target_speed_mph;
  if (mapAdvice && target_speed != null) {
    const diff = target_speed - currentMph;
    mapAdvice.textContent = Math.abs(diff) < 1 ? `${Math.round(target_speed)} mph`
      : diff > 0 ? `↑ ${Math.round(target_speed)} mph`
      : `↓ ${Math.round(target_speed)} mph`;
    mapAdvice.style.color = diff > 1 ? "#f59e0b" : diff < -1 ? "#4fffb0" : "#f0f0f0";
  }
  if (mapText && data?.distance != null) {
    mapText.textContent = `${Math.round(data.distance)}m away · ETA ${Math.round(data?.eta ?? 0)}s`;
  }

  // ── Coloured route line ──
  colorRoute(data);
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
window.addEventListener("load", async () => {
  try {
    await initWorld();
    initCamera(); // start camera in background; no-op if unavailable

    if (!route.length) {
      const adv = document.getElementById("advice");
      if (adv) adv.textContent = "Init failed";
      return;
    }

    loop();

  } catch (e) {
    console.error("INIT FAILED:", e);
    alert(`Init failed: ${e.message || e}`);
  }
});
