import time
import cv2
from collections import deque, Counter
import random

from vision.detector import detect_signal
from ui.simple_ui import SignalUI

# -------------------------
# CONFIGURATION
# -------------------------

STATE_WINDOW = 5
DETECT_INTERVAL = 0.1  # seconds

SIM_SPEED = 15        # m/s (~43 km/h)
SIM_INITIAL_DISTANCE = 110  # metres

GREEN_DURATION = 8
AMBER_DURATION = 2
RED_DURATION = 4

VIDEO_PATH = "test_videos/tv1.mp4"

VISION_RANGE_THRESHOLD = 50.0  # metres: below this we trust vision

MOCK_REPORTS = ["red", "green", "red", "green"]

# -------------------------
# INITIALIZATION
# -------------------------

sim_distance = SIM_INITIAL_DISTANCE
state_buffer = deque(maxlen=STATE_WINDOW)

phase_start_time = None
current_phase = None
prev_phase = None

# Layer 2: phase reports from other vehicles
phase_reports = {}  # dict of timestamp : phase
last_report_time = 0.0

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
prev_wall = 0.0
last_sample_time = 0.0

# -------------------------
# HELPERS
# -------------------------

def stable_state(buffer):
    filtered = [s for s in buffer if s != "unknown"]
    if not filtered:
        return "unknown"
    return Counter(filtered).most_common(1)[0][0]

def phase_duration(phase):
    if phase == "green": return GREEN_DURATION
    if phase == "amber": return AMBER_DURATION
    if phase == "red": return RED_DURATION
    return None

def compute_time_to_next_green(current_phase, t_in_phase):
    """
    Returns T_g:
    Signed time from now to the START of the next green window.
    If currently green, this will be negative (green already started).
    """
    if current_phase == "green":
        # current green started in the past
        return -t_in_phase

    if current_phase == "amber":
        return AMBER_DURATION - t_in_phase

    if current_phase == "red":
        return RED_DURATION - t_in_phase

    return None

def compute_advice(current_phase, arrival_time, T_g, time_left_current):
    if current_phase == "green":
        if arrival_time <= time_left_current:
          return "maintain_speed"
        elif arrival_time <= time_left_current + 5:
          return "speed_up"
        else:
          return "prepare_to_stop"
    if arrival_time < T_g:
        return "slow_down"
    elif arrival_time <= T_g + GREEN_DURATION:
        return "maintain_speed"
    else:
        return "prepare_to_stop"

# -------------------------
# Layer 2: Phase Learning helpers
# -------------------------

def add_phase_report(phase_reports, reported_phase, reported_duration):
    """
    Store a new report with current time.
    phase_reports: dict of report_id -> (timestamp, phase, duration)
    """
    ts = time.time()
    report_id = ts  # can be replaced with car ID if available
    phase_reports[report_id] = (ts, reported_phase, reported_duration)
    
def inc_mri(mri):
  if mri + 1 >= len(MOCK_REPORTS):
    return 0
  else:
    return mri + 1
    
def generate_mock_reports(phase_reports, last_report_time, mri, interval=3.0):
    """
    Generate 1-2 mock reports every `interval` seconds.
    Returns updated last_report_time.
    """
    now = time.time()
    if now - last_report_time < interval:
        return last_report_time, mri

    phase = MOCK_REPORTS[mri]
    mri = (mri + 1) % len(MOCK_REPORTS)
    duration = phase_duration(phase)
    add_phase_report(phase_reports, phase, duration)

    print(f"REPORTED: {phase}: {duration}")

    return now, mri

def get_consensus_phase(sim_distance, current_state, phase_reports, vision_range=50.0):
    """
    Decide which phase to use:
    - Trust vision if within range
    - Else, use valid recent reports
    - Reports expire once their phase duration is over
    """
    if sim_distance <= vision_range:
        return current_state

    now = time.time()
    scores = {"green": 0, "amber": 0, "red": 0}

    for ts, phase, duration in phase_reports.values():
        age = now - ts
        if age <= duration:
            # Linear decay: fresh = 1.0, nearly expired = 0.1
            weight = max(0.0001, 1.0 / age)
            scores[phase] += weight

    if not any(scores.values()):
        return current_state
    print(scores)

    # Return the phase with the highest total weight
    return max(scores, key=scores.get)


def remove_expired_reports(phase_reports):
    """
    Clean up expired reports to prevent memory growth
    """
    now = time.time()
    expired_keys = [k for k, (ts, _, dur) in phase_reports.items() if now - ts > dur]
    for k in expired_keys:
        del phase_reports[k]
        
def classify_arrival(arrival_time, T_g):
    """
    Determine which green window arrival falls into.

    Returns:
        window_index
        delta_to_start
        delta_to_end
    """

    C = GREEN_DURATION + AMBER_DURATION + RED_DURATION

    # Case 1: arrival before first upcoming green window
    if arrival_time < T_g:
        green_start = T_g
        green_end = green_start + GREEN_DURATION
        return 0, arrival_time - green_start, arrival_time - green_end

    # Case 2: arrival after or during future cycles
    cycles_ahead = int((arrival_time - T_g) // C)

    green_start = T_g + cycles_ahead * C
    green_end = green_start + GREEN_DURATION

    return cycles_ahead, arrival_time - green_start, arrival_time - green_end

def advisory_from_delta(delta_to_start, delta_to_end):
    if delta_to_start < 0:
        return "arrive_before_green"

    if delta_to_end <= 0:
        return "arrive_during_green"

    return "arrive_after_green"
  

mri = 0
# -------------------------
# MAIN LOOP
# -------------------------
while True:
    elapsed_wall = time.time() - start_wall

    # Frame sync to wall clock
    frame_idx = int(elapsed_wall * video_fps)
    if frame_idx >= total_frames:
        print("End of video")
        break
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    if not ret: break

    # --- DETECTION ---
    if elapsed_wall - last_sample_time >= DETECT_INTERVAL:
        last_sample_time = elapsed_wall
        _, buf = cv2.imencode(".jpg", frame)
        result = detect_signal(buf.tobytes())
        state_buffer.append(result.state)
        
    # --- MOCK EXTERNAL REPORTS ---
    last_report_time, mri = generate_mock_reports(
        phase_reports,
        last_report_time,
        mri,
        interval=2.5   # instead of 3.0
    )
    remove_expired_reports(phase_reports)

    # --- PHASE TRACKING ---
    vision_phase = stable_state(state_buffer)
    layer2_phase = get_consensus_phase(sim_distance, vision_phase, phase_reports)

    if layer2_phase != current_phase and layer2_phase in {"green", "amber", "red"}:
        prev_phase = current_phase
        current_phase = layer2_phase
        phase_start_time = elapsed_wall
        print(f"here changed to {current_phase}")

    # --- VEHICLE MOTION ---
    dt = elapsed_wall - prev_wall
    prev_wall = elapsed_wall
    sim_distance = max(0.0, sim_distance - SIM_SPEED * dt)
    arrival_time = sim_distance / SIM_SPEED if SIM_SPEED > 0 else float("inf")

    # --- SIGNAL TEMPORAL MODEL ---
    advice = "no_advice"
    delta = None
    T_g = None

    if current_phase is not None and phase_start_time is not None:
        t_in_phase = elapsed_wall - phase_start_time
        if current_phase is not None and phase_start_time is not None:

          t_in_phase = elapsed_wall - phase_start_time
          T_g = compute_time_to_next_green(current_phase, t_in_phase)

          window_index, delta_to_start, delta_to_end = classify_arrival(
              arrival_time,
              T_g
          )
          
          C = GREEN_DURATION + AMBER_DURATION + RED_DURATION

          if T_g is not None:
              phase_position = (arrival_time - T_g) % C
          else:
              phase_position = None

          advice = advisory_from_delta(delta_to_start, delta_to_end)
          delta = delta_to_start
        else:
          advice = "no_advice"
          delta = None
          window_index = None
          delta_to_start = None
          delta_to_end = None

    ui.update(
        advice,
        window_index,
        delta,
        distance=sim_distance,
        eta=arrival_time,
        phase_position=phase_position,
        green_dur=GREEN_DURATION,
        amber_dur=AMBER_DURATION,
        red_dur=RED_DURATION,
        red_before_dur=RED_DURATION,   # you can customise later
        red_after_dur=RED_DURATION     # same here for now
    )

    print(
    f"dist={sim_distance:.1f}m | "
    f"arr={arrival_time:.2f}s | "
    f"Tg={T_g:.2f} | "
    f"win={window_index} | "
    f"Δstart={delta_to_start:.2f} | "
    f"Δend={delta_to_end:.2f} | "
    f"{current_phase} | "
    f"{advice}"
  )

    # --- DISPLAY ---
    display_frame = frame.copy()
    cv2.putText(display_frame, f"State: {layer2_phase}", (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.imshow("Video", display_frame)
    if cv2.waitKey(1) & 0xFF == ord("q"): break

cap.release()
ui.close()
