"""Annotate any video with traffic-light detections.

Uses YOLOv8x (strongest COCO model) for annotation quality — better recall at distance.
Production system still runs YOLOv8n (vision/detector.py); this is annotation-only.

Usage:
    cd ~/Desktop/fyp/backend
    venv/bin/python3 annotate_video.py INPUT.mp4 [OUTPUT.mp4]

Output defaults to <input>_annotated.mp4.
First run downloads yolov8x.pt (~130 MB) via ultralytics.
"""
import sys, os, cv2

if len(sys.argv) < 2:
    sys.exit("usage: annotate_video.py INPUT.mp4 [OUTPUT.mp4]")

try:
    from ultralytics import YOLO
    anno_model = YOLO("yolov8x.pt")  # auto-downloads on first run
except ImportError:
    sys.exit("ultralytics not installed in this environment")

from vision.detector import infer_light_colour

inp = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(inp)[0] + "_annotated.mp4"

COLOURS = {"red": (0, 0, 255), "amber": (0, 170, 255),
           "green": (0, 255, 120), "unknown": (160, 160, 160)}
TRAFFIC_LIGHT_CLASS = 9  # COCO class index for "traffic light"
CONF_THRESH = 0.15       # lower than production (0.25) to catch distant lights

cap = cv2.VideoCapture(inp)
if not cap.isOpened():
    sys.exit(f"could not open {inp}")
fps = cap.get(cv2.CAP_PROP_FPS) or 25
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

i = 0
while True:
    ret, frame = cap.read()
    if not ret:
        break
    for r in anno_model(frame, conf=CONF_THRESH, verbose=False):
        for box, score, cls in zip(r.boxes.xyxy, r.boxes.conf, r.boxes.cls):
            if int(cls) != TRAFFIC_LIGHT_CLASS:
                continue
            x1, y1, x2, y2 = map(int, box[:4])
            crop = frame[y1:y2, x1:x2]
            state = infer_light_colour(crop) if crop.size else "unknown"
            col = COLOURS.get(state, COLOURS["unknown"])
            cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
            cv2.putText(frame, f"{state} {float(score):.2f}", (x1, max(12, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
    writer.write(frame)
    i += 1
    if i % 20 == 0:
        print(f"  {i}/{n} frames", flush=True)
cap.release(); writer.release()
print(f"saved {out}  ({i} frames)")
