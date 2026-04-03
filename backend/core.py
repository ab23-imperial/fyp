import time
import cv2
from collections import deque, Counter

from vision.detector import detect_signal
from ui.simple_ui import SignalUI

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

sim_distance = SIM_INITIAL_DISTANCE
state_buffer = deque(maxlen=STATE_WINDOW)

current_phase = None
phase_start_time = None

phase_reports = {}
last_report_time = 0.0
mri = 0

cap = cv2.VideoCapture(VIDEO_PATH)
if not cap.isOpened():
    raise RuntimeError("Could not open video")

video_fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

start_wall = time.time()
prev_wall = 0.0
last_sample_time = 0.0

# -------------------------
# HELPERS
# -------------------------

def stable_state(buffer):
    valid = [s for s in buffer if s != "unknown"]
    if not valid:
        return "unknown"
    return Counter(valid).most_common(1)[0][0]


def phase_duration(phase):
    if phase == "green":
        return GREEN_DURATION
    if phase == "amber":
        return AMBER_DURATION
    if phase == "red":
        return RED_DURATION
    return None


def compute_time_to_next_green(phase, t_in_phase):
    if phase == "green":
        return -t_in_phase
    if phase == "amber":
        return AMBER_DURATION - t_in_phase
    if phase == "red":
        return RED_DURATION - t_in_phase
    return None


def add_phase_report(phase_reports, phase):
    ts = time.time()
    phase_reports[ts] = (ts, phase, phase_duration(phase))


def generate_mock_reports(phase_reports, last_report_time, mri, interval=2.5):
    now = time.time()
    if now - last_report_time < interval:
        return last_report_time, mri

    phase = MOCK_REPORTS[mri]
    mri = (mri + 1) % len(MOCK_REPORTS)
    add_phase_report(phase_reports, phase)

    print(f"REPORTED: {phase}")
    return now, mri


def remove_expired_reports(phase_reports):
    now = time.time()
    expired = [k for k, (ts, _, dur) in phase_reports.items() if now - ts > dur]
    for k in expired:
        del phase_reports[k]


def get_consensus_phase(distance, vision_phase, phase_reports):
    if distance <= VISION_RANGE_THRESHOLD:
        return vision_phase

    now = time.time()
    scores = {"green": 0, "amber": 0, "red": 0}

    for ts, phase, duration in phase_reports.values():
        age = now - ts
        if age <= duration:
            weight = max(0.0001, 1.0 / age)
            scores[phase] += weight

    if not any(scores.values()):
        return vision_phase

    return max(scores, key=scores.get)


def classify_arrival(arrival_time, T_g):
    if T_g is None:
        return None, None, None

    if arrival_time < T_g:
        green_start = T_g
        green_end = green_start + GREEN_DURATION
        return 0, arrival_time - green_start, arrival_time - green_end

    cycles = int((arrival_time - T_g) // CYCLE_DURATION)
    green_start = T_g + cycles * CYCLE_DURATION
    green_end = green_start + GREEN_DURATION

    return cycles, arrival_time - green_start, arrival_time - green_end


def advisory_from_delta(delta_to_start, delta_to_end):
    if delta_to_start is None:
        return "no_advice"
    if delta_to_start < 0:
        return "arrive_before_green"
    if delta_to_end <= 0:
        return "arrive_during_green"
    return "arrive_after_green"

def step_simulation(
    start_wall: float,
    state: dict,
    cap,
    video_fps: float,
    total_frames: int,
    state_buffer: list,
    phase_reports: list,
    mri,
):
    elapsed_wall = time.time() - start_wall

    # --- Frame control ---
    frame_idx = int(elapsed_wall * video_fps)
    if frame_idx >= total_frames:
        return False, state, None

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    if not ret:
        return False, state, None

    # --- Detection ---
    if elapsed_wall - state["last_sample_time"] >= DETECT_INTERVAL:
        state["last_sample_time"] = elapsed_wall
        _, buf = cv2.imencode(".jpg", frame)
        result = detect_signal(buf.tobytes())
        state_buffer.append(result.state)

    # --- External reports ---
    state["last_report_time"], mri = generate_mock_reports(
        phase_reports, state["last_report_time"], mri
    )
    remove_expired_reports(phase_reports)

    # --- Phase estimation ---
    vision_phase = stable_state(state_buffer)
    layer2_phase = get_consensus_phase(
        state["sim_distance"], vision_phase, phase_reports
    )

    if (
        layer2_phase in {"green", "amber", "red"}
        and layer2_phase != state["current_phase"]
    ):
        state["current_phase"] = layer2_phase
        state["phase_start_time"] = elapsed_wall
        print(f"Phase changed to {state['current_phase']}")

    # --- Vehicle motion ---
    dt = elapsed_wall - state["prev_wall"]
    state["prev_wall"] = elapsed_wall

    state["sim_distance"] = max(
        0.0, state["sim_distance"] - SIM_SPEED * dt
    )
    arrival_time = (
        state["sim_distance"] / SIM_SPEED if SIM_SPEED > 0 else float("inf")
    )

    # --- Temporal model ---
    T_g = None
    window_index = None
    delta_start = None
    delta_end = None
    phase_position = None

    if (
        state["current_phase"] is not None
        and state["phase_start_time"] is not None
    ):
        t_in_phase = elapsed_wall - state["phase_start_time"]
        T_g = compute_time_to_next_green(
            state["current_phase"], t_in_phase
        )

        window_index, delta_start, delta_end = classify_arrival(
            arrival_time, T_g
        )

        if T_g is not None:
            phase_position = (arrival_time - T_g) % CYCLE_DURATION

    advice = advisory_from_delta(delta_start, delta_end)

    # --- Debug ---
    print(
        f"dist={state['sim_distance']:.1f}m | "
        f"arr={arrival_time:.2f}s | "
        f"Tg={T_g if T_g is not None else 'None'} | "
        f"win={window_index} | "
        f"Δstart={delta_start} | "
        f"Δend={delta_end} | "
        f"{state['current_phase']} | "
        f"{advice}"
    )

    # --- Output payload ---
    output = {
        "advice": advice,
        "window_index": window_index,
        "delta_start": delta_start,
        "distance": state["sim_distance"],
        "eta": arrival_time,
        "phase_position": phase_position,
        "green_dur": GREEN_DURATION,
        "amber_dur": AMBER_DURATION,
        "red_dur": RED_DURATION,
        "red_before_dur": RED_DURATION,
        "red_after_dur": RED_DURATION,
    }

    return True, state, output, mri, frame
  
def step_logic_only(state, state_buffer, phase_reports, gps):
    now = time.time()
    dt = now - state["last_update_time"]
    state["last_update_time"] = now

    # --- Motion ---
    speed = gps.get("speed", 5.0)

    state["sim_distance"] = max(0, state["sim_distance"] - speed * dt)
    distance = state["sim_distance"]
    arrival_time = distance / max(speed, 0.1)

    # --- Vision placeholder ---
    vision_phase = "green"   # temporary

    # --- Phase estimation ---
    layer2_phase = get_consensus_phase(
        distance, vision_phase, phase_reports
    )

    if (
        layer2_phase in {"green", "amber", "red"}
        and layer2_phase != state["current_phase"]
    ):
        state["current_phase"] = layer2_phase
        state["phase_start_time"] = now

    # --- Temporal model (IDENTICAL to simulation) ---
    T_g = None
    window_index = None
    delta_start = None
    delta_end = None
    phase_position = None

    if state["current_phase"] and state["phase_start_time"]:
        t_in_phase = now - state["phase_start_time"]

        T_g = compute_time_to_next_green(
            state["current_phase"], t_in_phase
        )

        window_index, delta_start, delta_end = classify_arrival(
            arrival_time, T_g
        )

        if T_g is not None:
            phase_position = (arrival_time - T_g) % CYCLE_DURATION

    advice = advisory_from_delta(delta_start, delta_end)

    # --- Debug (same richness as sim) ---
    print(
        f"dist={distance:.1f}m | "
        f"arr={arrival_time:.2f}s | "
        f"Tg={T_g} | "
        f"win={window_index} | "
        f"Δstart={delta_start} | "
        f"Δend={delta_end} | "
        f"{state['current_phase']} | "
        f"{advice}"
    )

    return {
        "advice": advice,
        "distance": distance,
        "eta": arrival_time,
        "phase": state["current_phase"],
        "window_index": window_index,
        "delta_start": delta_start,
        "delta_end": delta_end,
        "phase_position": phase_position,
    }
    
def step_core(
    state,
    state_buffer,
    phase_reports,
    *,
    now=None,
    speed=None,
    frame=None,
    use_vision=False,
):
    if now is None:
        now = time.time()

    # ---------------- TIME ----------------
    dt = now - state.get("last_update_time", now)
    state["last_update_time"] = now

    # ---------------- MOTION ----------------
    if speed is None:
        speed = SIM_SPEED

    state["sim_distance"] = max(0, state["sim_distance"] - speed * dt)
    distance = state["sim_distance"]
    arrival_time = distance / max(speed, 0.1)

    # ---------------- VISION ----------------
    if use_vision and frame is not None:
        elapsed = now - state.get("start_wall", now)

        if elapsed - state.get("last_sample_time", 0) >= DETECT_INTERVAL:
            state["last_sample_time"] = elapsed
            _, buf = cv2.imencode(".jpg", frame)
            result = detect_signal(buf.tobytes())
            state_buffer.append(result.state)

        vision_phase = stable_state(state_buffer)
    else:
        # fallback (can swap to random later)
        vision_phase = "green"

    # ---------------- REPORTS ----------------
    state["last_report_time"], state["mri"] = generate_mock_reports(
        phase_reports,
        state.get("last_report_time", 0),
        state.get("mri", 0),
    )

    remove_expired_reports(phase_reports)

    # ---------------- PHASE ESTIMATION ----------------
    layer2_phase = get_consensus_phase(
        distance, vision_phase, phase_reports
    )

    if (
        layer2_phase in {"green", "amber", "red"}
        and layer2_phase != state.get("current_phase")
    ):
        state["current_phase"] = layer2_phase
        state["phase_start_time"] = now

    # ---------------- TEMPORAL MODEL ----------------
    T_g = None
    window_index = None
    delta_start = None
    delta_end = None
    phase_position = None

    if state.get("current_phase") and state.get("phase_start_time"):
        t_in_phase = now - state["phase_start_time"]

        T_g = compute_time_to_next_green(
            state["current_phase"], t_in_phase
        )

        window_index, delta_start, delta_end = classify_arrival(
            arrival_time, T_g
        )

        if T_g is not None:
            phase_position = (arrival_time - T_g) % CYCLE_DURATION

    advice = advisory_from_delta(delta_start, delta_end)

    # ---------------- DEBUG ----------------
    print(
        f"dist={distance:.1f}m | "
        f"arr={arrival_time:.2f}s | "
        f"Tg={T_g} | "
        f"win={window_index} | "
        f"Δstart={delta_start} | "
        f"Δend={delta_end} | "
        f"{state.get('current_phase')} | "
        f"{advice}"
    )

    return {
        "advice": advice,
        "distance": distance,
        "eta": arrival_time,
        "phase": state.get("current_phase"),
        "window_index": window_index,
        "delta_start": delta_start,
        "delta_end": delta_end,
        "phase_position": phase_position,
        "green_dur": GREEN_DURATION,
        "amber_dur": AMBER_DURATION,
        "red_dur": RED_DURATION,
        "red_before_dur": RED_DURATION,
        "red_after_dur": RED_DURATION,
    }
    
def main():
  state = {
      "sim_distance": 100,
      "current_phase": None,
      "phase_start_time": None,
  }

  state_buffer = []
  phase_reports = {}

  gps = {"lat": 19.0, "lon": 72.0, "speed": 5}

  for _ in range(5):
      result = step_logic_only(state, state_buffer, phase_reports, gps)
      print(result)
      time.sleep(1)
  
if __name__ == "__main__":
  main()