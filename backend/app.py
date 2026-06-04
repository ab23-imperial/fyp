from flask import Flask, request, jsonify, send_from_directory
from collections import deque
import os
import time
import base64
import socket
import cv2
import numpy as np
import requests

from core import step_core, init_world
from world_builder import build_world
from phase_logger import PhaseLogger
from signal_store import init_firestore

app = Flask(__name__, static_folder="../frontend")

logger = PhaseLogger()
init_firestore()

# ---------------- WORLD (single source of truth) ----------------
# route, signals = init_world()

SPEED_LIMIT = 40

world = {}

# world = {
#     "route": route,
#     "signals": signals
# }

# print("INIT WORLD:", world)

# ---------------- VIDEO ----------------
_video_path = "test_videos/tv1.mp4"
cap = cv2.VideoCapture(_video_path) if os.path.exists(_video_path) else None
video_fps = cap.get(cv2.CAP_PROP_FPS) if cap else 25.0
start_wall = time.time()

# ---------------- STATE ----------------
def reset_state():
    return {
        "current_signal_id": None,
        "current_phase": None,
        "phase_start_time": None,
        "last_update_time": time.time(),
        "signal_start_time": time.time(),
        "active_signal_idx": 0,
        "prev_distance_to_signal": None,
    }

state = reset_state()
state_buffer = deque(maxlen=5)
phase_reports = {}

# ---------------- ROUTES ----------------
@app.route("/")
def home():
    global state, state_buffer, phase_reports

    state = reset_state()
    state_buffer.clear()
    phase_reports.clear()

    return send_from_directory("../frontend", "index.html")

@app.route("/signup")
def signup():
    return send_from_directory("../frontend", "signup.html")

@app.route("/login")
def login():
    return send_from_directory("../frontend", "login.html")

@app.route("/route")
def route():
    return send_from_directory("../frontend", "route.html")
  
@app.route("/drive")
def drive():
    global state, state_buffer, phase_reports

    state = reset_state()
    state_buffer.clear()
    phase_reports.clear()
    return send_from_directory("../frontend", "drive.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("../frontend", path)


@app.route("/init_route", methods=["POST"])
def init_route():
    data = request.json

    start = tuple(data["start"])   # [lat, lon]
    end = tuple(data["end"])       # [lat, lon]

    print(f"INIT ROUTE: start={start}, end={end}")

    route, signals, speed_limits = build_world(start, end)

    world["route"] = route
    world["signals"] = signals
    world["speed_limits"] = speed_limits

    print("UPDATED WORLD:", world)

    global state
    state = reset_state()
    state_buffer.clear()
    phase_reports.clear()

    return jsonify({
        "route": route,
        "signals": signals
    })

@app.route("/init")
def init():
    return jsonify({
        "route": world["route"],
        "signals": world["signals"]
    })


@app.route("/init_from_gps", methods=["POST"])
def init_from_gps():
    data = request.json

    start = (data["lat"], data["lon"])
    end = world["route"][-1]  # or pass from frontend

    print(f"GPS INIT: start={start}, end={end}")

    route, signals, speed_limits = build_world(start, end)

    world["route"] = route
    world["signals"] = signals
    world["speed_limits"] = speed_limits

    print("UPDATED WORLD:", world)

    global state
    state = reset_state()
    state_buffer.clear()
    phase_reports.clear()

    return jsonify({
        "route": world["route"],
        "signals": world["signals"]
    })


@app.route("/gps", methods=["POST"])
def gps():
    data = request.json

    now = time.time()

    # Prefer live camera frame from phone; fall back to test video
    frame_b64 = data.get("frame_b64")
    if frame_b64:
        img_bytes = base64.b64decode(frame_b64)
        img_arr   = np.frombuffer(img_bytes, np.uint8)
        frame     = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        use_cam   = frame is not None
    else:
        if cap:
            elapsed   = now - start_wall
            frame_idx = int(elapsed * video_fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                frame = None
        use_cam = False

    route_idx = data.get("route_idx") or 0
    speed_limits = world.get("speed_limits", [])
    if speed_limits and 0 <= route_idx < len(speed_limits):
        speed_limit = speed_limits[route_idx]
    else:
        speed_limit = SPEED_LIMIT

    result = step_core(
        state,
        state_buffer,
        phase_reports,
        world["signals"],
        route=world["route"],
        now=now,
        speed=data.get("speed", 12.5),
        lat=data.get("lat"),
        lon=data.get("lon"),
        frame=frame,
        use_vision=use_cam,
        do_mock_reports=False,
        logger=logger,
        route_idx=data.get("route_idx"),
        speed_limit=speed_limit
    )

    return jsonify(result)

@app.route("/vision")
def vision_page():
    return send_from_directory("../frontend", "vision.html")


@app.route("/detect", methods=["POST"])
def detect():
    from vision.detector import detect_signal
    data = request.json or {}
    frame_b64 = data.get("frame_b64", "")
    if not frame_b64:
        return jsonify({"phase": "unknown"})
    img_bytes = base64.b64decode(frame_b64)
    img_arr   = np.frombuffer(img_bytes, np.uint8)
    frame     = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify({"phase": "unknown"})
    result = detect_signal(img_bytes)
    return jsonify({"phase": result.state, "confidence": result.confidence})


if __name__ == "__main__":
    try:
        # Connect to an external address to find the real LAN IP (no packet sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "localhost"

    print(f"\n{'='*50}")
    print(f"  Local (Mac):  http://localhost:5051")
    print(f"  Phone HTTP:   http://{local_ip}:5051")
    print(f"  (Camera needs HTTPS — install pyopenssl for auto-SSL,")
    print(f"   or run: ngrok http 5051)")
    print(f"{'='*50}\n")

    try:
        import OpenSSL  # noqa: F401
        print("SSL available — serving HTTPS on port 5051")
        app.run(host="0.0.0.0", port=5051, ssl_context="adhoc")
    except ImportError:
        app.run(host="0.0.0.0", port=5051)