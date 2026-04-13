import json

class PhaseLogger:
    def __init__(self, path="phases.json"):
        self.path = path
        self.data = []

    def log(self, signal_id, phase, timestamp):
        entry = {
            "signal_id": signal_id,
            "phase": phase,
            "timestamp": timestamp
        }

        self.data.append(entry)

        # overwrite file completely
        with open(self.path, "w") as f:
            json.dump(self.data, f, indent=2)