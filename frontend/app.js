let lat = 19.006295404255074;
let lon = 72.82930553467953;

const SIGNALS = [
  { id: 1, lat: 19.006304427054125, lon: 72.82317790283602 },
  { id: 2, lat: 19.0063103622219, lon: 72.8181054726819 }
];

let currentTargetIdx = 0;

let SPEED = 39;

window.addEventListener("keydown", (e) => {
  if (e.key === "w") {
    SPEED += 2;
  }
  if (e.key === "s") {
    SPEED = Math.max(1, SPEED - 2);
  }

  console.log("Speed:", SPEED);
});

let lastTime = performance.now();

const EPS = 0.5; // metres

const ARRIVAL_THRESHOLD = 5; // metres

function updateTargetIfReached(prevDist, currentDist) {
  if (currentDist < ARRIVAL_THRESHOLD) {
    if (currentTargetIdx < SIGNALS.length - 1) {
      currentTargetIdx++;
      console.log("reached signal → switching");
    }
    return;
  }

  // fallback: overshoot detection
  if (prevDist !== null && currentDist > prevDist + EPS) {
    if (currentTargetIdx < SIGNALS.length - 1) {
      currentTargetIdx++;
      console.log("overshot signal → switching");
    }
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;

  const toRad = x => x * Math.PI / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(dlambda / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------- GEO MOVE ----------------
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

  if (dist < 0.1) return;

  const moveDist = Math.min(speed * dt, dist);
  const ratio = moveDist / dist;

  const newLat = lat1 + dLat * ratio;
  const newLon = lon1 + dLon * ratio;

  lat = toDeg(newLat);
  lon = toDeg(newLon);
}

// ---------------- MAIN LOOP ----------------
let prevDist = null;

async function loop() {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  try {
    const target = SIGNALS[currentTargetIdx];

    // compute distance BEFORE move
    const distBefore = haversine(lat, lon, target.lat, target.lon);

    moveTowards(target.lat, target.lon, SPEED, dt);

    // compute distance AFTER move
    const distAfter = haversine(lat, lon, target.lat, target.lon);

    updateTargetIfReached(prevDist, distAfter);
    prevDist = distAfter;

    const res = await fetch("http://localhost:5050/gps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat,
        lon,
        speed: SPEED
      })
    });

    const data = await res.json();

    if (data) updateUI(data);

  } catch (err) {
    console.error("Fetch error:", err);
  }

  setTimeout(loop, 200);
}

function updateUI(data) {
  // ---------------- ADVICE ----------------
  const adviceMap = {
    arrive_before_green: ["ARRIVE BEFORE GREEN", "red"],
    arrive_during_green: ["ARRIVE DURING GREEN", "lime"],
    arrive_after_green: ["ARRIVE AFTER GREEN", "orange"],
    no_advice: ["NO DATA", "grey"]
  };

  const [text, colour] = adviceMap[data?.advice] || ["NO DATA", "grey"];

  const adviceEl = document.getElementById("advice");
  adviceEl.innerText = text;
  adviceEl.style.color = colour;

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

  // ---------------- TEXT ----------------
  const textEl = document.getElementById("text");

  if (textEl && data?.distance !== undefined && data?.eta !== undefined) {
    const speedKmh = (SPEED * 3.6).toFixed(1);

    textEl.innerText =
      `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(2)}s | ${speedKmh} km/h`;
  }

  const signalEl = document.getElementById("signal-status");

  if (signalEl && data?.phase) {
    const map = {
      green: "🟢",
      amber: "🟠",
      red: "🔴",
      unknown: "⚪"
    };

    const emoji = map[data.phase] || "⚪";

    // small, clean, includes id subtly
    signalEl.innerText = `${emoji} ${data.signal_id ?? ""}`;
  }
}

window.onload = () => {
  console.log("STARTING LOOP");
  loop();
};