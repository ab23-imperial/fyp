console.log("JS LOADED");
navigator.geolocation.watchPosition(async pos => {
  const res = await fetch("/gps", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      speed: pos.coords.speed || 5
    })
  });

  const data = await res.json();

  document.getElementById("advice").innerText = data.advice;
  document.getElementById("info").innerText =
    `${Math.round(data.distance)}m | ETA ${data.eta.toFixed(2)}s`;
});