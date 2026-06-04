import os
"""
Firestore-backed crowdsourced signal store.

Requires backend/firebase-service-account.json (download from
Firebase console → Project settings → Service accounts → Generate new key).

If the file is missing or firebase-admin isn't installed, all functions
degrade silently so the rest of the app continues working.
"""

import threading
import time
from datetime import datetime, timezone

_db = None

def init_firestore(cred_path="firebase-service-account.json"):
    global _db
    try:
        import firebase_admin, json, tempfile
        from firebase_admin import credentials, firestore as fs
        if not firebase_admin._apps:
            env_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
            if env_json:
                tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
                tmp.write(env_json)
                tmp.close()
                cred = credentials.Certificate(tmp.name)
            elif os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
            else:
                print(f"[signal_store] No service account file or env var — Firestore disabled")
                return
            firebase_admin.initialize_app(cred)
        _db = fs.client()
        print("Firestore connected ✓")
    except Exception as e:
        print(f"[signal_store] Firestore init failed: {e}")


def _doc_id(osm_id):
    return f"osm_{osm_id}"


def report_phase(osm_id, lat, lon, phase, green_dur, amber_dur, red_dur, uid=None):
    """
    Write a phase observation to Firestore.
    Runs in a background thread — never blocks the main loop.
    """
    if _db is None or osm_id is None:
        return

    def _write():
        try:
            from firebase_admin import firestore as fs
            ref = _db.collection("signals").document(_doc_id(osm_id))
            data = {
                "lat":           lat,
                "lon":           lon,
                "phase":         phase,
                "last_reported": datetime.now(timezone.utc),
                "green_dur":     green_dur,
                "amber_dur":     amber_dur,
                "red_dur":       red_dur,
                "report_count":  fs.Increment(1),
            }
            if uid:
                data["last_reporter"] = uid
            ref.set(data, merge=True)
            print(f"[Firestore] reported {phase} for {_doc_id(osm_id)}")
        except Exception as e:
            print(f"[signal_store] write error: {e}")

    threading.Thread(target=_write, daemon=True).start()


def fetch_phases(signals, stale_seconds=600):
    """
    Enrich each signal dict with Firestore phase data if a recent
    report exists (within stale_seconds). Adds:
      signal['fs_phase'] — e.g. 'green'
      signal['fs_ts']    — Unix timestamp of the report
    """
    if _db is None:
        return signals

    now = time.time()
    found = 0
    try:
        for sig in signals:
            osm_id = sig.get("osm_id")
            if not osm_id:
                continue
            doc = _db.collection("signals").document(_doc_id(osm_id)).get()
            if not doc.exists:
                continue
            d = doc.to_dict()
            ts_obj = d.get("last_reported")
            if ts_obj is None:
                continue
            reported_ts = ts_obj.timestamp()
            if now - reported_ts < stale_seconds:
                sig["fs_phase"] = d.get("phase")
                sig["fs_ts"]    = reported_ts
                found += 1
    except Exception as e:
        print(f"[signal_store] fetch error: {e}")

    if found:
        print(f"[Firestore] bootstrapped {found}/{len(signals)} signals from crowdsourced data")
    return signals
