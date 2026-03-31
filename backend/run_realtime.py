import time
import cv2
from collections import deque, Counter

from vision.detector import detect_signal
from ui.simple_ui import SignalUI
from core import step_simulation

# -------------------------
# CONFIGURATION
# -------------------------

STATE_WINDOW = 5
DETECT_INTERVAL = 0.1

SIM_SPEED = 12
SIM_INITIAL_DISTANCE = 120

GREEN_DURATION = 8
AMBER_DURATION = 2
RED_DURATION = 4

VIDEO_PATH = "test_videos/tv1.mp4"
VISION_RANGE_THRESHOLD = 50.0

MOCK_REPORTS = ["red", "green", "red", "green"]

CYCLE_DURATION = GREEN_DURATION + AMBER_DURATION + RED_DURATION

# -------------------------
# INITIALIZATION
# -------------------------

state_buffer = deque(maxlen=STATE_WINDOW)

phase_reports = {}
mri = 0

cap = cv2.VideoCapture(VIDEO_PATH)
if not cap.isOpened():
    raise RuntimeError("Could not open video")

video_fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

ui = SignalUI()

cv2.namedWindow("Video", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Video", 800, 450)
cv2.moveWindow("Video", 600, 0)

start_wall = time.time()

state = {
    "prev_wall": 0.0,
    "last_sample_time": 0.0,
    "last_report_time": 0.0,
    "sim_distance": SIM_INITIAL_DISTANCE,
    "current_phase": None,
    "phase_start_time": None,
}

# -------------------------
# MAIN LOOP
# -------------------------

while True:
    cont, state, output, mri, frame = step_simulation(
        start_wall,
        state,
        cap,
        video_fps,
        total_frames,
        state_buffer,
        phase_reports,
        mri,
    )

    if not cont:
        break

    if output:
        ui.update(
            output["advice"],
            output["window_index"],
            output["delta_start"],
            distance=output["distance"],
            eta=output["eta"],
            phase_position=output["phase_position"],
            green_dur=output["green_dur"],
            amber_dur=output["amber_dur"],
            red_dur=output["red_dur"],
            red_before_dur=output["red_before_dur"],
            red_after_dur=output["red_after_dur"],
        )
    display = frame.copy()

    cv2.putText(
        display,
        f"Phase: {state['current_phase']}",
        (30, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )

    cv2.imshow("Video", display)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
ui.close()