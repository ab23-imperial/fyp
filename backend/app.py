from flask import Flask, request, jsonify, send_from_directory
from core import step_core
from collections import deque
import time

app = Flask(__name__, static_folder="../frontend")

# persistent state
state = {
    "sim_distance": 100,
    "current_phase": None,
    "phase_start_time": None,
    "last_update_time": time.time(),
    "last_report_time": 0,
    "mri": 0,
}

state_buffer = deque(maxlen=5)
phase_reports = {}

# serve index.html
@app.route("/")
def home():
    return send_from_directory("../frontend", "index.html")

# serve JS and other static files
@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("../frontend", path)

@app.route("/gps", methods=["POST"])
def gps():
    data = request.json

    result = step_core(
        state,
        state_buffer,
        phase_reports,
        speed=data.get("speed", 5),
        use_vision=False,
    )

    return jsonify(result)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)