import requests
import folium
import random
import time

WORLD_CACHE = {}

# ---------------- HEADERS ----------------
HEADERS = {
    "User-Agent": "traffic-advisory-app/1.0 (contact: youremail@example.com)"
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ---------------- ROUTE ----------------
def get_route(start, end):
    url = (
        "http://router.project-osrm.org/route/v1/driving/"
        f"{start[1]},{start[0]};{end[1]},{end[0]}"
        "?overview=full&geometries=geojson"
    )

    r = SESSION.get(url, timeout=20)
    r.raise_for_status()

    data = r.json()
    coords = data["routes"][0]["geometry"]["coordinates"]

    return [(c[1], c[0]) for c in coords]


# ---------------- SIGNALS ----------------
def get_signals(route):
    lats = [p[0] for p in route]
    lons = [p[1] for p in route]

    query = f"""
    [out:json][timeout:25];
    node["highway"="traffic_signals"]
    ({min(lats)-0.01},{min(lons)-0.01},{max(lats)+0.01},{max(lons)+0.01});
    out;
    """

    urls = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]

    for attempt in range(3):  # reduced retries
        for url in urls:
            try:
                r = SESSION.post(url, data=query, timeout=30)

                if r.status_code == 200:
                    data = r.json()
                    return [(n["lat"], n["lon"]) for n in data.get("elements", [])]

                # 429 / 406 / 5xx handling
                if r.status_code in (406, 429, 500, 502, 503):
                    print(f"Overpass busy ({r.status_code}) → retrying...")
                    continue

                print(f"Overpass fail {r.status_code}")
            except Exception as e:
                print("Overpass error:", e)

        # exponential backoff
        time.sleep(2 ** attempt)

    return []


# ---------------- MATCH ----------------
def match_signals(route, signals, radius=5):
    out = []
    for s in signals:
        dist = min(haversine(s, p) for p in route)
        if dist < radius:
            out.append(s)
    return out


def haversine(a, b):
    import math
    R = 6371000
    lat1, lon1 = a
    lat2, lon2 = b

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    x = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2 * R * math.atan2(math.sqrt(x), math.sqrt(1-x))


# ---------------- TIMINGS ----------------
def attach_timings(signals, route):
    return [
        {
            "id": i,
            "lat": s[0],
            "lon": s[1],
            "route_idx": find_closest_route_index(s, route),
            "green": random.randint(15, 60),
            "amber": 2,
            "red": random.randint(15, 60),
        }
        for i, s in enumerate(signals, start=1)
    ]

def find_closest_route_index(signal, route):
    best_idx = 0
    best_dist = float("inf")

    for i, p in enumerate(route):
        d = haversine((signal[0], signal[1]), (p[0], p[1]))
        if d < best_dist:
            best_dist = d
            best_idx = i

    return best_idx

# ---------------- BUILD ----------------
def round_coord(c):
    return (round(c[0], 3), round(c[1], 3))


def build_world(start, end):
    key = (round_coord(start), round_coord(end))

    if key in WORLD_CACHE:
        return WORLD_CACHE[key]

    route = get_route(start, end)
    raw = get_signals(route)
    matched = match_signals(route, raw)
    signals = attach_timings(matched, route)
    signals.sort(key=lambda s: s["route_idx"])   # 👈 ADD THIS

    WORLD_CACHE[key] = (route, signals)
    render_map(route, signals)
    return route, signals
  
def render_map(route, signals):
    center = route[len(route)//2]

    m = folium.Map(location=center, zoom_start=14)

    folium.PolyLine(route, color="blue", weight=5, opacity=0.8).add_to(m)

    folium.Marker(route[0], popup="START",
                  icon=folium.Icon(color="green")).add_to(m)

    folium.Marker(route[-1], popup="END",
                  icon=folium.Icon(color="red")).add_to(m)

    for i, s in enumerate(signals):
        folium.CircleMarker(
            location=(s['lat'], s['lon']),
            radius=5,
            color="orange",
            fill=True,
            fill_opacity=0.8,
            popup=f"Signal {i+1}"
        ).add_to(m)

    m.save("route_map.html")
    print("\nSaved → route_map.html")