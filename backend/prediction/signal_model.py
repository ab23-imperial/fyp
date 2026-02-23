SIGNAL_CYCLE = [
    ("green", 30.0),
    ("amber", 4.0),
    ("red", 30.0),
]

def predict_signal_state(current_state, elapsed, arrival_time):
    if current_state not in {s for s, _ in SIGNAL_CYCLE}:
        return current_state

    t = elapsed + arrival_time

    idx = next(
        i for i, (s, _) in enumerate(SIGNAL_CYCLE)
        if s == current_state
    )

    cycle = SIGNAL_CYCLE[idx:] + SIGNAL_CYCLE[:idx]

    for state, duration in cycle:
        if t < duration:
            return state
        t -= duration
        
def get_advice(predicted_state):
    if predicted_state == "green":
        return "maintain_speed"
    if predicted_state == "amber":
        return "prepare_to_stop"
    if predicted_state == "red":
        return "slow_down"
    return "no_advice"
