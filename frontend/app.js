import { sendFrame, predictArrival } from "./api.js";

async function main() {
  const vision = await sendFrame(frameBlob);
  const prediction = await predictArrival({
    signal_state: vision.signal_state,
    eta: eta
  });

  updateUI(prediction.advice);
}

main();
