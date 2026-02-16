from flask import Flask, jsonify
from vision.detector import detect_signal
from prediction.signal_model import predict_signal_state
from prediction.advisory import get_advice
import cv2
import numpy as np
import time

VIDEO_PATH = "test_videos/tv1.mp4"
FIXED_ETA = 8.0

app = Flask(__name__)

cap = cv2.VideoCapture(VIDEO_PATH)

def detect_from_video():
    global cap

    ret, frame = cap.read()

    if not ret or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, frame = cap.read()

    if not ret or frame is None:
        return DetectionResult("unknown", 0.0)

    _, buf = cv2.imencode(".jpg", frame)
    img_bytes = buf.tobytes()

    return detect_signal(img_bytes)


@app.route("/detect", methods=["POST"])
def detect():
    result = detect_from_video()

    return jsonify({
        "signal_state": result.state,
        "confidence": result.confidence,
        "timestamp": time.time()
    })

@app.route("/predict", methods=["POST"])
def predict():
    result = detect_from_video()

    predicted = predict_signal_state(
        current_state=result.state,
        elapsed=0.0,
        arrival_time=FIXED_ETA
    )

    advice = get_advice(predicted)

    return jsonify({
        "current_state": result.state,
        "predicted_state": predicted,
        "advice": advice
    })


if __name__ == "__main__":
    app.run(debug=True)
