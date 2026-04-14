let lat = 19.006295404255074;
let lon = 72.82930553467953;

const TARGET_LAT = 19.006304427054125;
const TARGET_LON = 72.82317790283602;

const SPEED = 13; // m/s

let lastTime = performance.now();

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
async function loop() {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  try {
    moveTowards(TARGET_LAT, TARGET_LON, SPEED, dt);

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
  const redBefore = data?.red_before_dur ?? 4;
  const green = data?.green_dur ?? 8;
  const redAfter = data?.red_after_dur ?? 4;

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
    textEl.innerText =
      `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(2)}s`;
  }
}

loop();