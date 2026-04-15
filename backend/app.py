from flask import Flask, request, jsonify, send_from_directory
from core import step_core, SIGNALS
from collections import deque
import time
import cv2

from core import detect_signal, stable_state
from phase_logger import PhaseLogger

cap = cv2.VideoCapture("test_videos/tv1.mp4")
video_fps = cap.get(cv2.CAP_PROP_FPS)
start_wall = time.time()

state_buffer = deque(maxlen=5)
last_sample_time = 0.0

app = Flask(__name__, static_folder="../frontend")

logger = PhaseLogger()

# persistent state
state = {
    "current_signal_id": None,
    "current_phase": None,
    "phase_start_time": None,
    "last_update_time": time.time(),
    "last_report_time": 0,
    "mri": 0,
    "true_phase_memory": {},
    "signal_start_time": time.time(),
}
state["start_wall"] = start_wall

state_buffer = deque(maxlen=5)
phase_reports = {}

# serve index.html
@app.route("/")
def home():
    global state, state_buffer, phase_reports

    state.clear()
    state_buffer.clear()
    phase_reports.clear()

    return send_from_directory("../frontend", "index.html")

# serve JS and other static files
@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("../frontend", path)

@app.route("/gps", methods=["POST"])
def gps():
    data = request.json

    now = time.time()
    elapsed = now - start_wall

    # --- FRAME SYNC (same as old system) ---
    frame_idx = int(elapsed * video_fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

    ret, frame = cap.read()
    if not ret:
        frame = None
    print(f"Data: {data}")
        
    result = step_core(
        state,
        state_buffer,
        phase_reports,
        now=now,
        speed=data.get("speed", 12.5),
        lat=data.get("lat"),
        lon=data.get("lon"),
        frame=frame,
        use_vision=False,   # 👈 TURNED ON
        do_mock_reports=False,
        logger=logger
    )

    return jsonify(result)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)