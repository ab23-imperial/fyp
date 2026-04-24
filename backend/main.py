import requests
import folium
import math

# -----------------------------
# INPUTS
# -----------------------------
# START = (19.0760, 72.8777)
# END   = (19.0180, 72.8435)

START = (51.49538527920054, -0.18298237009240356)
END = (51.50238200712, -0.18821964439170594)
# START = 19.008504229019124, 72.82237148280866
# END = 19.00629650092297, 72.82158991396373

SIGNAL_RADIUS = 5
ROUTE_SAMPLE_STEP = 10  # reduces API calls massively


# -----------------------------
# OSRM ROUTE
# -----------------------------
def get_route(start, end):
    lat1, lon1 = start
    lat2, lon2 = end

    url = (
        "http://router.project-osrm.org/route/v1/driving/"
        f"{lon1},{lat1};{lon2},{lat2}"
        "?overview=full&geometries=geojson"
    )

    data = requests.get(url).json()
    coords = data["routes"][0]["geometry"]["coordinates"]

    return [(c[1], c[0]) for c in coords]

def match_signals(route, signals, threshold=30):
    matched = []

    for s in signals:
        for i in range(len(route) - 1):
            a = route[i]
            b = route[i + 1]

            # quick segment proximity check
            d = min(
                haversine(s, a),
                haversine(s, b)
            )

            if d <= threshold:
                matched.append(s)
                break

    return matched

# -----------------------------
# DISTANCE
# -----------------------------
def haversine(a, b):
    R = 6371000
    lat1, lon1 = a
    lat2, lon2 = b

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    x = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2 * R * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def get_signals_bbox_fast(route):
    lats = [p[0] for p in route]
    lons = [p[1] for p in route]

    padding = 0.01  # small expansion

    min_lat, max_lat = min(lats) - padding, max(lats) + padding
    min_lon, max_lon = min(lons) - padding, max(lons) + padding

    query = f"""
    [out:json][timeout:25];
    (
      node["highway"="traffic_signals"]({min_lat},{min_lon},{max_lat},{max_lon});
    );
    out;
    """

    url = "https://overpass.kumi.systems/api/interpreter"

    try:
        res = requests.post(url, data=query, timeout=60)

        if res.status_code != 200:
            print("Overpass failed:", res.status_code)
            return []

        data = res.json()

        return [(el["lat"], el["lon"]) for el in data.get("elements", [])]

    except Exception as e:
        print("Overpass error:", e)
        return []

# -----------------------------
# MAP RENDER
# -----------------------------
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
            location=s,
            radius=5,
            color="orange",
            fill=True,
            fill_opacity=0.8,
            popup=f"Signal {i+1}"
        ).add_to(m)

    m.save("route_map.html")
    print("\nSaved → route_map.html")


# -----------------------------
# MAIN
# -----------------------------
def main():
    print("Fetching route...")
    route = get_route(START, END)

    print(f"Route points: {len(route)}")

    print("Fetching signals (FAST)...")
    raw_signals = get_signals_bbox_fast(route)
    signals = match_signals(route, raw_signals, SIGNAL_RADIUS)

    print(f"Signals found: {len(signals)}")

    render_map(route, signals)


if __name__ == "__main__":
    main()