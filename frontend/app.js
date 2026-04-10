async function loop() {
  try {
    const res = await fetch("/gps", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        lat: 0,
        lon: 0,
        speed: 12.5
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