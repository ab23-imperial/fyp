async function loop() {
  const res = await fetch("/gps", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      lat: 0,
      lon: 0,
      speed: 5
    })
  });

  const data = await res.json();

  updateUI(data);

  setTimeout(loop, 200);
}

function updateUI(data) {
  const adviceMap = {
    arrive_before_green: ["ARRIVE BEFORE GREEN", "red"],
    arrive_during_green: ["ARRIVE DURING GREEN", "lime"],
    arrive_after_green: ["ARRIVE AFTER GREEN", "orange"],
    no_advice: ["NO DATA", "grey"]
  };

  const [text, colour] = adviceMap[data.advice] || ["NO DATA", "grey"];

  const adviceEl = document.getElementById("advice");
  adviceEl.innerText = text;
  adviceEl.style.color = colour;

  const redBefore = data.red_before_dur;
  const green = data.green_dur;
  const redAfter = data.red_after_dur;

  const total = redBefore + green + redAfter;

  const red1 = document.getElementById("red1");
  const greenDiv = document.getElementById("green");
  const red2 = document.getElementById("red2");

  red1.style.flex = redBefore;
  greenDiv.style.flex = green;
  red2.style.flex = redAfter;

  const container = document.getElementById("container");
  const car = document.getElementById("car");

  const delta = data.delta_start;

  if (delta !== null && delta !== undefined) {
    const topBound = -redBefore;
    const bottomBound = green + redAfter;

    const clamped = Math.max(topBound, Math.min(delta, bottomBound));
    const ratio = (clamped - topBound) / (bottomBound - topBound);

    const y = container.clientHeight * ratio;

    car.style.top = `${y - 50}px`; // center car
  }

  document.getElementById("text").innerText =
    `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(2)}s`;
}

loop();