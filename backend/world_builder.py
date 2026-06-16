import requests
import folium

WORLD_CACHE = {}

# ---------------- HEADERS ----------------
HEADERS = {
    "User-Agent": "traffic-advisory-app/1.0 (contact: agastya.bahl2004@gmail.com)"
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ---------------- ROUTE ----------------
_DEFAULT_SPEED_LIMIT_MPH = 30

def _parse_maxspeed(entry):
    if not entry or "speed" not in entry:
        return None
    speed = entry["speed"]
    unit  = entry.get("unit", "km/h")
    return round(speed if unit == "mph" else speed / 1.60934)


def get_route(start, end):
    base = (
        "http://router.project-osrm.org/route/v1/driving/"
        f"{start[1]},{start[0]};{end[1]},{end[0]}"
        "?overview=full&geometries=geojson"
    )

    for url in [base + "&annotations=maxspeed", base]:
        r = SESSION.get(url, timeout=20)
        if r.status_code == 400 and "annotations" in url:
            continue
        r.raise_for_status()
        break

    data       = r.json()
    route_data = data["routes"][0]
    coords     = route_data["geometry"]["coordinates"]
    route      = [(c[1], c[0]) for c in coords]

    try:
        raw = route_data["legs"][0]["annotation"]["maxspeed"]
        speed_limits = [(_parse_maxspeed(e) or _DEFAULT_SPEED_LIMIT_MPH) for e in raw]
    except (KeyError, TypeError):
        speed_limits = []

    expected     = max(len(route) - 1, 0)
    speed_limits = (speed_limits + [_DEFAULT_SPEED_LIMIT_MPH] * expected)[:expected]

    return route, speed_limits


# ---------------- SIGNALS ----------------
def get_signals(route):
    lats = [p[0] for p in route]
    lons = [p[1] for p in route]

    south = min(lats) - 0.01
    west  = min(lons) - 0.01
    north = max(lats) + 0.01
    east  = max(lons) + 0.01

    # Request full tags so we can read timing data
    query = (
        f"[out:json][timeout:30];"
        f'node["highway"="traffic_signals"]({south},{west},{north},{east});'
        f"out body;"
    )

    r = SESSION.post(
        "https://overpass-api.de/api/interpreter",
        data={"data": query},
        timeout=35,
    )
    r.raise_for_status()
    return r.json().get("elements", [])


# ---------------- MATCH ----------------
def match_signals(route, signals, radius=5):
    out = []
    for s in signals:
        coord = (s["lat"], s["lon"])
        dist = min(haversine(coord, p) for p in route)
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
_DEFAULT_GREEN = 30
_DEFAULT_AMBER = 2
_DEFAULT_RED   = 6

def _parse_seconds(val, default):
    """Parse an OSM tag value like "30" or "30 s" to an integer number of seconds."""
    if val is None:
        return default
    try:
        return max(1, int(float(str(val).strip().rstrip("s").strip())))
    except (ValueError, TypeError):
        return default


def attach_timings(signals, route):
    result = []
    for i, node in enumerate(signals, start=1):
        tags = node.get("tags", {})

        green = _parse_seconds(
            tags.get("traffic_signals:green") or tags.get("green_duration"),
            _DEFAULT_GREEN
        )
        amber = _parse_seconds(
            tags.get("traffic_signals:amber") or tags.get("amber_duration"),
            _DEFAULT_AMBER
        )
        red = _parse_seconds(
            tags.get("traffic_signals:red") or tags.get("red_duration"),
            _DEFAULT_RED
        )

        # If only cycle_time is available, split remaining time evenly between green/red
        cycle_time = _parse_seconds(tags.get("cycle_time"), None)
        if cycle_time and cycle_time > amber:
            if green == _DEFAULT_GREEN and red == _DEFAULT_RED:
                remaining = cycle_time - amber
                green = remaining // 2
                red   = remaining - green

        osm_timing = any(
            k in tags for k in ("traffic_signals:green", "traffic_signals:red", "cycle_time")
        )
        source = "osm" if osm_timing else "default"
        print(f"  Signal {i}: {source} timings  g={green}s  a={amber}s  r={red}s")

        result.append({
            "id": i,
            "osm_id": node.get("id"),
            "lat": node["lat"],
            "lon": node["lon"],
            "route_idx": find_closest_route_index((node["lat"], node["lon"]), route),
            "green": green,
            "amber": amber,
            "red":   red,
        })
    return result


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
    # start = (51.4995937, -0.1966461)
    # end=(51.4986222, -0.1996693)
    key = (round_coord(start), round_coord(end))

    if key in WORLD_CACHE:
        return WORLD_CACHE[key]

    route, speed_limits = get_route(start, end)
    raw = get_signals(route)
    matched = match_signals(route, raw)
    signals = attach_timings(matched, route)
    signals.sort(key=lambda s: s["route_idx"])

    from signal_store import fetch_phases
    signals = fetch_phases(signals)

    WORLD_CACHE[key] = (route, signals, speed_limits)
    render_map(route, signals)
    return route, signals, speed_limits

  
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
