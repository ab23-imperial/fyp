import time
import cv2
from collections import deque, Counter
import math

from vision.detector import detect_signal
from ui.simple_ui import SignalUI
from phase_logger import PhaseLogger

# -------------------------
# CONFIGURATION
# -------------------------

STATE_WINDOW = 5
DETECT_INTERVAL = 0.1

SIM_SPEED = 12
SIM_INITIAL_DISTANCE = 120

# SIGNALS = [
#     {"id": 1, "distance": 120, "green": 2, "amber": 2, "red": 6},
#     {"id": 2, "distance": 180, "green": 5, "amber": 2, "red": 8},
#     {"id": 3, "distance": 90,  "green": 3, "amber": 1, "red": 5},
# ]

SIGNALS = [
    {"id": 1, "lat": 19.006304427054125, "lon": 72.82317790283602, "green": 2, "amber": 2, "red": 6},
    {"id": 2, "lat": 19.0063103622219, "lon": 72.8181054726819, "green": 5, "amber": 2, "red": 8},
]

GREEN_DURATION = 2
AMBER_DURATION = 2
RED_DURATION = 6

VIDEO_PATH = "test_videos/tv1.mp4"
VISION_RANGE_THRESHOLD = 5000

MOCK_REPORTS = ["red", "green", "red", "green"]

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

def get_true_phase(signal, t):
    cycle = signal["green"] + signal["amber"] + signal["red"]
    t_mod = t % cycle

    if t_mod < signal["green"]:
        return "green"
    elif t_mod < signal["green"] + signal["amber"]:
        return "amber"
    else:
        return "red"
      
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_nearest_signal(lat, lon):
    return min(
        SIGNALS,
        key=lambda s: haversine(lat, lon, s["lat"], s["lon"])
    )
  
def stable_state(buffer):
    valid = [s for s in buffer if s != "unknown"]
    if not valid:
        return "unknown"
    return Counter(valid).most_common(1)[0][0]


def phase_duration(phase, signal):
    if phase == "green":
        return signal["green"]
    if phase == "amber":
        return signal["amber"]
    if phase == "red":
        return signal["red"]
    return None

def compute_time_to_next_green(phase, t_in_phase, signal):
    if phase == "green":
        return (
            signal["green"] - t_in_phase +   # finish current green
            signal["amber"] +                # amber
            signal["red"]                   # red
        )
    if phase == "amber":
        return (
            signal["amber"] - t_in_phase +
            signal["red"]
        )
    if phase == "red":
        return signal["red"] - t_in_phase

def add_phase_report(phase_reports, phase, signal):
    ts = time.time()
    phase_reports[ts] = (ts, phase, phase_duration(phase, signal))

# def generate_mock_reports(phase_reports, last_report_time, mri, signal, interval=2.5):
#     now = time.time()
#     if now - last_report_time < interval:
#         return last_report_time, mri

#     phase = get_true_phase(signal, now)
#     # mri = (mri + 1) % len(MOCK_REPORTS)
#     add_phase_report(phase_reports, phase, signal)

#     print(f"REPORTED: {phase}")
#     return now, mri
  
def generate_mock_reports(state, phase_reports, signal, now):
    signal_id = signal["id"]

    # get true phase from simulation
    t = now - state["signal_start_time"]
    true_phase = get_true_phase(signal, t)

    # get last phase for THIS signal
    last_phase = state["true_phase_memory"].get(signal_id)

    # only report on transition
    if true_phase != last_phase:
        add_phase_report(phase_reports, true_phase, signal)
        state["true_phase_memory"][signal_id] = true_phase

        print(f"REPORTED (transition): {signal_id} → {true_phase}")


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


def classify_arrival(arrival_time, T_g, signal):
    if T_g is None:
        return None, None, None

    cycle = signal["green"] + signal["amber"] + signal["red"]
    phase_position = (arrival_time - T_g) % cycle

    if arrival_time < T_g:
        green_start = T_g
        green_end = green_start + signal["green"]
        return 0, arrival_time - green_start, arrival_time - green_end

    cycles = int((arrival_time - T_g) // cycle)
    green_start = T_g + cycles * cycle
    green_end = green_start + signal["green"]

    return cycles, arrival_time - green_start, arrival_time - green_end


def advisory_from_delta(delta_to_start, delta_to_end):
    if delta_to_start is None:
        return "no_advice"
    if delta_to_start < 0:
        return "arrive_before_green"
    if delta_to_end <= 0:
        return "arrive_during_green"
    return "arrive_after_green"
    
def step_core(
    state,
    state_buffer,
    phase_reports,
    *,
    lat=None,
    lon=None,
    now=None,
    speed=None,
    frame=None,
    use_vision=False,
    do_mock_reports=True,
    logger=None
):
    if logger is None:
        logger = PhaseLogger()
    if now is None:
        now = time.time()

    # ---------------- TIME ----------------
    dt = now - state.get("last_update_time", now)
    state["last_update_time"] = now
    
    signal = get_nearest_signal(lat, lon)

    # ---------------- MOTION ----------------
    if speed is None:
        speed = SIM_SPEED
    
    # ---------------- SIGNAL TRANSITION ----------------
    if signal["id"] != state.get("current_signal_id"):
      state["current_signal_id"] = signal["id"]
      state["signal_start_time"] = now
      state["current_phase"] = None
      state["phase_start_time"] = None

      state_buffer.clear()
      phase_reports.clear()

      print(f"\n--- Switched to signal {signal['id']} ---\n")
    # if state["sim_distance"] <= 0:
    #   state["current_signal_idx"] += 1

    #   if state["current_signal_idx"] >= len(SIGNALS):
    #       # loop for now
    #       state["current_signal_idx"] = 0

    #   next_signal = SIGNALS[state["current_signal_idx"]]

    #   # reset for next signal
    #   state["sim_distance"] = next_signal["distance"]
    #   state["current_phase"] = None
    #   state["phase_start_time"] = None

    #   state_buffer.clear()
    #   phase_reports.clear()
    #   state["last_report_time"] = 0
    #   state["mri"] = 0
    #   state["signal_start_time"] = now

    #   print(f"\n--- Switched to signal {next_signal['id']} ---\n")
      
    # distance = state["sim_distance"]
    # print(f"dist betw ({lat}, {lon}) and ({signal["lat"]}, {signal["lon"]})")
    distance = haversine(
        lat, lon,
        signal["lat"], signal["lon"]
    )
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
        t = now - state["signal_start_time"]
        vision_phase = get_true_phase(signal, t)

    # ---------------- REPORTS ----------------
    if do_mock_reports:
      generate_mock_reports(state, phase_reports, signal, now)

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

        logger.log(
            signal_id=signal["id"],
            phase=layer2_phase,
            timestamp=now
        )

    # ---------------- TEMPORAL MODEL ----------------
    T_g = None
    window_index = None
    delta_start = None
    delta_end = None
    phase_position = None

    if state.get("current_phase") and state.get("phase_start_time"):
        t = now - state["signal_start_time"]

        cycle = signal["green"] + signal["amber"] + signal["red"]
        t_mod = t % cycle

        g = signal["green"]
        a = signal["amber"]
        r = signal["red"]

        if t_mod < g:
            # currently green
            T_g = g - t_mod + a + r
        elif t_mod < g + a:
            # currently amber
            T_g = (g + a) - t_mod + r
        else:
            # currently red
            T_g = cycle - t_mod
            
        t = now - state["signal_start_time"]
        cycle = g + a + r
        t_mod = t % cycle

        in_green = t_mod < g
        time_left_in_green = g - t_mod
        
        if in_green and arrival_time <= time_left_in_green:
          # ARRIVING IN CURRENT GREEN
          window_index = 0
          delta_start = arrival_time + t_mod
          delta_end = delta_start - g
        else:
          window_index, delta_start, delta_end = classify_arrival(
              arrival_time, T_g, signal
          )

          if T_g is not None:
              cycle = signal["green"] + signal["amber"] + signal["red"]
              phase_position = (arrival_time - T_g) % cycle

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
        "green_dur": signal["green"],
        "amber_dur": signal["amber"],
        "red_dur": signal["red"],
        "red_before_dur": signal["red"],
        "red_after_dur": signal["red"],
    }
    
# def main():
#   logger = PhaseLogger()
#   state = {
#     "sim_distance": SIGNALS[0]["distance"],
#     "current_signal_idx": 0,
#     "current_phase": None,
#     "phase_start_time": None,
#     "last_update_time": time.time(),
#     "last_report_time": 0,
#     "mri": 0,
#   }

#   state_buffer = []
#   phase_reports = {}

#   gps = {"lat": 19.0, "lon": 72.0, "speed": 5}

#   for _ in range(5):
#       result = step_core(
#         state,
#         state_buffer,
#         phase_reports,
#         speed=gps["speed"],
#         logger=logger
#       )
#       print(result)
#       time.sleep(1)
  
# if __name__ == "__main__":
#   main()