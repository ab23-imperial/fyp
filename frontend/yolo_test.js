let video, canvas, ctx;
let session;

const MODEL_PATH = "/yolov8n.onnx"; // export this
const TRAFFIC_LIGHT_CLASS = 9;

async function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });

  video.srcObject = stream;
  await new Promise(res => video.onloadedmetadata = res);

  canvas.width = 640;
  canvas.height = 640;
}

async function loadModel() {
  log("Starting model load...");

  try {
    log("Fetching model...");
    const r = await fetch(MODEL_PATH);
    log("Fetch status: " + r.status);

    const blob = await r.blob();
    log("Model size MB: " + (blob.size / 1e6).toFixed(2));

    log("Creating session...");

    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;

    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["wasm"]
    });

    log("Model loaded successfully ✅");

  } catch (e) {
    log("ERROR: " + e.message);
  }
}

// ---------------- PREPROCESS ----------------
function preprocess() {
  ctx.drawImage(video, 0, 0, 640, 640);

  const imageData = ctx.getImageData(0, 0, 640, 640);
  const { data } = imageData;

  const floatData = new Float32Array(3 * 640 * 640);

  for (let i = 0; i < 640 * 640; i++) {
    floatData[i] = data[i * 4] / 255;
    floatData[i + 640 * 640] = data[i * 4 + 1] / 255;
    floatData[i + 2 * 640 * 640] = data[i * 4 + 2] / 255;
  }

  return {
    tensor: new ort.Tensor("float32", floatData, [1, 3, 640, 640]),
    imageData
  };
}

// ---------------- YOLO POSTPROCESS ----------------
// works for yolov8 ONNX output
function getTrafficLightBox(output) {
  const out = output[Object.keys(output)[0]].data;

  let best = null;

  for (let i = 0; i < out.length; i += 84) {
    const x = out[i];
    const y = out[i + 1];
    const w = out[i + 2];
    const h = out[i + 3];

    const objConf = out[i + 4];

    let maxClass = -1;
    let maxProb = 0;

    for (let c = 0; c < 80; c++) {
      const prob = out[i + 5 + c];
      if (prob > maxProb) {
        maxProb = prob;
        maxClass = c;
      }
    }

    const score = objConf * maxProb;

    if (maxClass === TRAFFIC_LIGHT_CLASS && score > 0.4) {
      if (!best || score > best.score) {
        best = { x, y, w, h, score };
      }
    }
  }

  return best;
}

// ---------------- CROP ----------------
function cropBox(imageData, box) {
  const { width, height, data } = imageData;

  const x1 = Math.max(0, Math.floor((box.x - box.w / 2) * width));
  const y1 = Math.max(0, Math.floor((box.y - box.h / 2) * height));
  const x2 = Math.min(width, Math.floor((box.x + box.w / 2) * width));
  const y2 = Math.min(height, Math.floor((box.y + box.h / 2) * height));

  const cropW = x2 - x1;
  const cropH = y2 - y1;

  const crop = [];

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 4;
      crop.push([
        data[idx],
        data[idx + 1],
        data[idx + 2]
      ]);
    }
  }

  return { pixels: crop, w: cropW, h: cropH };
}

// ---------------- COLOUR DETECTION ----------------
// simplified version of your HSV logic
function inferLightColour(crop) {
  let red = 0, green = 0, amber = 0;

  for (const [r, g, b] of crop.pixels) {
    if (r > 150 && g < 100) red++;
    else if (g > 150 && r < 100) green++;
    else if (r > 150 && g > 120) amber++;
  }

  const threshold = 50;

  if (red > green && red > amber && red > threshold) return "red";
  if (amber > red && amber > green && amber > threshold) return "amber";
  if (green > red && green > amber && green > threshold) return "green";

  return "unknown";
}

// ---------------- LOOP ----------------
async function loop() {
  if (!session) return;

  const { tensor, imageData } = preprocess();

  const feeds = {};
  feeds[session.inputNames[0]] = tensor;

  const results = await session.run(feeds);

  const box = getTrafficLightBox(results);

  const outputEl = document.getElementById("output");

  if (!box) {
    outputEl.innerText = "No light detected";
    requestAnimationFrame(loop);
    return;
  }

  const crop = cropBox(imageData, box);
  const state = inferLightColour(crop);

  outputEl.innerText = `${state.toUpperCase()} (${box.score.toFixed(2)})`;

  outputEl.style.color =
    state === "red" ? "red" :
    state === "green" ? "lime" :
    "orange";

  requestAnimationFrame(loop);
}

function log(msg) {
  const el = document.getElementById("debug");
  el.innerText += msg + "\n";
}

// ---------------- INIT ----------------
async function main() {
  await initCamera();
  await loadModel();
  loop();
}

main();