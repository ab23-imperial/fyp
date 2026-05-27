import time
import cv2
from collections import deque, Counter
import math

from vision.detector import detect_signal
from ui.simple_ui import SignalUI
from phase_logger import PhaseLogger
from world_builder import build_world

# -------------------------
# CONFIGURATION
# -------------------------

# START = (51.49538527920054, -0.18298237009240356) # Gloucester road
START = (51.50238200712, -0.18821964439170594) #  High street
END = 51.503305724164406, -0.1533343537676268 # Knightsbridge
# START = 19.008504229019124, 72.82237148280866
# END = 19.00629650092297, 72.82158991396373
# START = 18.911684927211624, 72.82267284368089 # Acro
# START = 19.008016427499072, 72.82208522753751 # Artesia
# END = 19.008016427499072, 72.82208522753751 # Artesia
# END = 19.063222250540132, 72.83081203243785 # Shiv Asthan

STATE_WINDOW = 5
DETECT_INTERVAL = 0.1

SIM_SPEED = 12
SIM_INITIAL_DISTANCE = 120

SWITCH_DISTANCE_THRESHOLD = 20

# SIGNALS = [
#     {"id": 1, "lat": 19.006304427054125, "lon": 72.82317790283602, "green": 2, "amber": 2, "red": 6},
#     {"id": 2, "lat": 19.0063103622219, "lon": 72.8181054726819, "green": 5, "amber": 2, "red": 8},
# ]

# start = (51.49538527920054, -0.18298237009240356)
# end = (51.50238200712, -0.18821964439170594)

route = None
SIGNALS = None

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

def init_world():
    # start = (51.49538527920054, -0.18298237009240356)
    # end = (51.50238200712, -0.18821964439170594)
    start = START
    end = END
    return build_world(start, end)

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
    
def get_active_signal(state, signals):
    idx = state.get("active_signal_idx", 0)
    idx = min(idx, len(signals) - 1)
    if idx < 0 or idx >= len(signals):
        print(f"IDX: {idx}")
        idx = 0
    current = signals[idx]

    route_idx = state.get("route_idx", 0)

    # passed signal if route index passed it
    if route_idx > current["route_idx"]:
        if idx + 1 < len(signals):
            idx += 1
            state["active_signal_idx"] = idx
            return signals[idx]

    return current
  
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
  
def compute_target_speed_mph(distance_m, signal, t_mod, current_speed_mps, window_index, speed_limit):
    current_mph = current_speed_mps * 2.23694
    g = signal["green"]
    a = signal["amber"]
    r = signal["red"]
    cycle = g + a + r

    candidate_bands = []  # (lo, hi)

    for k in range(max(0, window_index - 1), window_index + 3):
        if k == 0:
            # currently in green — arrive before it ends
            time_left = g - t_mod
            if time_left <= 0:
                continue
            v_max = distance_m / max(time_left, 0.1)
            v_min = 0.0
        else:
            # future green window k
            green_start = (cycle - t_mod) + (k - 1) * cycle
            green_end = green_start + g
            if green_start <= 0:
                continue
            v_max = distance_m / max(green_start, 0.1)
            v_min = distance_m / max(green_end, 0.1)

        mph_min = max(0, v_min * 2.23694)
        mph_max = min(speed_limit, v_max * 2.23694)

        if mph_min <= mph_max:
            candidate_bands.append((mph_min, mph_max))

    if not candidate_bands:
        return None, None, None

    # pick band closest to current speed
    best_speed = None
    best_cost = float("inf")
    best_lo = None
    best_hi = None

    for lo, hi in candidate_bands:
        # clamp current speed into band
        target = max(lo, min(current_mph, hi))
        cost = abs(target - current_mph)
        if target < 8:
            cost += 5
        if cost <= best_cost:
            best_cost = cost
            best_speed = target
            best_lo = lo
            best_hi = hi

    return best_speed, best_lo, best_hi

def compute_all_bands(distance_m, signal, t_mod, speed_limit):
    """Returns all valid green windows as (lo, hi) mph bands."""
    g = signal["green"]
    a = signal["amber"]
    r = signal["red"]
    cycle = g + a + r

    bands = []

    for k in range(0, 5):  # check up to 5 future windows
        if k == 0:
            time_left = g - t_mod
            if time_left <= 0:
                continue
            v_min = distance_m / max(time_left, 0.1)
            v_max = speed_limit
        else:
            green_start = (cycle - t_mod) + (k - 1) * cycle
            green_end = green_start + g
            if green_start <= 0:
                continue
            v_max = distance_m / max(green_start, 0.1)
            v_min = distance_m / max(green_end, 0.1)

        mph_min = max(0, v_min * 2.23694)
        mph_max = min(speed_limit, v_max * 2.23694)

        if mph_min <= mph_max and mph_max > 5:
            bands.append({"lo": round(mph_min, 1), "hi": round(mph_max, 1)})

    return bands
  
def update_route_progress(state, route, lat, lon):
    idx = state["route_idx"]

    if idx >= len(route) - 1:
        return idx

    next_pt = route[idx]
    dist = haversine(lat, lon, next_pt[0], next_pt[1])

    if dist < 6:  # same threshold as frontend
        state["route_idx"] += 1

    return state["route_idx"]
  
def route_distance_to_signal(route, current_idx, signal_idx, lat, lon):
    signal_pt = route[signal_idx]
    actual_dist = haversine(lat, lon, signal_pt[0], signal_pt[1])

    if signal_idx <= current_idx and actual_dist < 15:
        return 0

    dist = 0

    # 🔥 KEY FIX: current position → next waypoint
    next_pt = route[current_idx]
    dist += haversine(lat, lon, next_pt[0], next_pt[1])

    # remaining full segments
    for i in range(current_idx, signal_idx):
        a = route[i]
        b = route[i + 1]
        dist += haversine(a[0], a[1], b[0], b[1])

    return dist
    
def step_core(
    state,
    state_buffer,
    phase_reports,
    signals,
    *,
    route=None,
    lat=None,
    lon=None,
    now=None,
    speed=None,
    frame=None,
    use_vision=False,
    do_mock_reports=True,
    logger=None,
    route_idx=None,
    speed_limit=None
):
    if logger is None:
        logger = PhaseLogger()
    if now is None:
        now = time.time()
        
    # ---------------- TIME ----------------
    dt = now - state.get("last_update_time", now)
    state["last_update_time"] = now
    state.setdefault("prev_distance_to_signal", None)
    state.setdefault("passed_signal", False)
    state.setdefault("route_idx", 0)
    
    signal = get_active_signal(state, signals)

    # ---------------- MOTION ----------------
    if speed is None:
        speed = SIM_SPEED
    
    # ---------------- SIGNAL TRANSITION ----------------
    if signal["id"] != state.get("current_signal_id"):
      state["current_signal_id"] = signal["id"]

      # RESET EVERYTHING CLEANLY
      # state["signal_start_time"] = now
      state["current_phase"] = None
      state["phase_start_time"] = None

      state["prev_distance_to_signal"] = None

      state_buffer.clear()
      phase_reports.clear()

      print(f"\n--- Switched to signal {signal['id']} ---\n")
    
    # distance = haversine(
    #     lat, lon,
    #     signal["lat"], signal["lon"]
    # )
    
    if route_idx is not None:
        state["route_idx"] = route_idx
        route_idx = route_idx
    else:
        # REAL GPS MODE
        route_idx = update_route_progress(state, route, lat, lon)

    distance = route_distance_to_signal(
        route,
        route_idx,
        signal["route_idx"],
        lat,
        lon
    )
    speed = max(speed or SIM_SPEED, 0.1)
    arrival_time = distance / speed

    # --- compute signal-relative time ---
    t = now - state["signal_start_time"]
    cycle = signal["green"] + signal["amber"] + signal["red"]
    t_mod = t % cycle

    # ---------------- VISION ----------------
    if use_vision and frame is not None:
        # Frontend throttles to 1 frame/s, so always process when frame arrives
        _, buf = cv2.imencode(".jpg", frame)
        result = detect_signal(buf.tobytes())
        if result.state != "unknown":
            state_buffer.append(result.state)
        vision_phase = stable_state(state_buffer)
    else:
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

        # Anchor the cycle clock from what the camera actually sees
        if use_vision:
            g, a = signal["green"], signal["amber"]
            if layer2_phase == "green":
                state["signal_start_time"] = now
            elif layer2_phase == "amber":
                state["signal_start_time"] = now - g
            else:
                state["signal_start_time"] = now - g - a
            print(f"Vision anchored cycle: phase={layer2_phase} signal_id={signal['id']}")

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
    advice = None

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
          advice = "arrive_during_green"
        else:
          window_index, delta_start, delta_end = classify_arrival(
              arrival_time, T_g, signal
          )
          advice = advisory_from_delta(delta_start, delta_end)
          if T_g is not None:
              cycle = signal["green"] + signal["amber"] + signal["red"]
              phase_position = (arrival_time - T_g) % cycle
    
    # ---------------- TARGET SPEED ----------------

    target_mph = None
    speed_band = None

    if advice == "arrive_during_green":

        current_mph = speed * 2.23694

        target_mph = current_mph

        speed_band = {
            "min": current_mph - 2,
            "max": current_mph + 2,
            "target": current_mph
        }
    elif advice is not None and window_index is not None:
        result = compute_target_speed_mph(
            distance_m=distance,
            signal=signal,
            t_mod=t_mod,
            current_speed_mps=speed,
            window_index=window_index,
            speed_limit=speed_limit or 80
        )

        target_mph, band_lo, band_hi = result[0], result[1], result[2]

        if target_mph is not None:
            speed_band = {
                "min": band_lo,
                "max": band_hi,
                "target": target_mph
            }
            
    all_bands = compute_all_bands(
        distance, signal, t_mod, speed_limit or 80
    ) if distance > 0 else []

    # ---------------- DEBUG ----------------

    target_str = (
        f"{target_mph:.1f}"
        if target_mph is not None
        else "None"
    )
    print(
        f"dist={distance:.1f}m | "
        f"arr={arrival_time:.2f}s | "
        f"Tg={T_g} | "
        f"win={window_index} | "
        f"Δstart={delta_start} | "
        f"Δend={delta_end} | "
        f"{state.get('current_phase')} | "
        f"{advice} | "
        f"curr={speed*2.23694:.1f}mph → target={target_str} | "
        f"tmod={t_mod} | "
        f"all bands: {all_bands}"
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
        "signal_id": signal["id"],
        "signal_route_idx": signal["route_idx"],
        "t_mod": t_mod,
        "target_speed_mph": target_mph,
        "current_speed_mph": speed * 2.23694,
        "speed_band": speed_band,
        "speed_bands": all_bands,
    }
