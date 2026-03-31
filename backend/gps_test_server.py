# gps_test_server.py
from flask import Flask, request, jsonify

app = Flask(__name__)

latest_gps = {}

@app.route("/")
def index():
    return """
    <!DOCTYPE html>
    <html>
    <body>
      <h1>GPS Test</h1>
      <p id="status">Waiting for GPS...</p>
      <script>
      navigator.geolocation.watchPosition(
        pos => {
          document.getElementById("status").innerText = "Sending GPS...";
          fetch("/gps", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              speed: pos.coords.speed || 0
            })
          });
        },
        err => {
          document.getElementById("status").innerText = "ERROR: " + err.message;
        },
        { enableHighAccuracy: true }
      );
      </script>
    </body>
    </html>
    """

@app.route("/gps", methods=["POST"])
def gps():
    data = request.json
    print("GPS:", data)
    latest_gps.update(data)
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)