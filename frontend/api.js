// api.js
export async function sendFrame(blob) {
  const fd = new FormData();
  fd.append("image", blob);

  const res = await fetch("/detect", { method: "POST", body: fd });
  return res.json();
}

export async function predictArrival(payload) {
  const res = await fetch("/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
}
