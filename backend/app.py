from flask import Flask, request, jsonify, send_from_directory
from collections import deque
import time
import cv2

from core import step_core, init_world
from world_builder import build_world
from phase_logger import PhaseLogger

app = Flask(__name__, static_folder="../frontend")

logger = PhaseLogger()

# ---------------- WORLD (single source of truth) ----------------
# route, signals = init_world()

SPEED_LIMIT = 35

world = {}

# world = {
#     "route": route,
#     "signals": signals
# }

# print("INIT WORLD:", world)

# ---------------- VIDEO ----------------
cap = cv2.VideoCapture("test_videos/tv1.mp4")
video_fps = cap.get(cv2.CAP_PROP_FPS)
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

    route, signals = build_world(start, end)

    # update world
    world["route"] = route
    world["signals"] = signals

    print("UPDATED WORLD:", world)

    # reset state
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

    route, signals = build_world(start, end)

    # ✅ update single source of truth
    world["route"] = route
    world["signals"] = signals

    print("UPDATED WORLD:", world)

    # ✅ reset runtime state to match new signals
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
    elapsed = now - start_wall

    frame_idx = int(elapsed * video_fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

    ret, frame = cap.read()
    if not ret:
        frame = None

    result = step_core(
        state,
        state_buffer,
        phase_reports,
        world["signals"],          # ✅ always latest signals
        route=world["route"],     # ✅ always latest route
        now=now,
        speed=data.get("speed", 12.5),
        lat=data.get("lat"),
        lon=data.get("lon"),
        frame=frame,
        use_vision=False,
        do_mock_reports=False,
        logger=logger,
        route_idx=data.get("route_idx"),
        speed_limit=SPEED_LIMIT
    )

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)