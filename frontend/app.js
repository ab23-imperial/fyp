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
  document.getElementById("advice").innerText = data.advice;

  const redBefore = data.red_before_dur;
  const green = data.green_dur;
  const redAfter = data.red_after_dur;

  const total = redBefore + green + redAfter;

  const red1 = document.getElementById("red1");
  const greenDiv = document.getElementById("green");
  const red2 = document.getElementById("red2");

  red1.style.height = (redBefore / total) * 100 + "%";
  greenDiv.style.height = (green / total) * 100 + "%";
  red2.style.height = (redAfter / total) * 100 + "%";

  const container = document.getElementById("container");
  const car = document.getElementById("car");

  const delta = data.delta_start;

  if (delta !== null && delta !== undefined) {

    const topBound = -redBefore;
    const bottomBound = green + redAfter;

    const clamped = Math.max(topBound, Math.min(delta, bottomBound));

    const ratio = (clamped - topBound) / (bottomBound - topBound);

    const y = container.clientHeight * ratio;

    car.style.top = y + "px";
  }

  document.getElementById("text").innerText =
    `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(2)}s`;
}

loop();