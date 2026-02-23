from ultralytics import YOLO
import cv2
import numpy as np

model = YOLO("yolov8n.pt")

class DetectionResult:
    def __init__(self, state, confidence):
        self.state = state
        self.confidence = confidence


def infer_light_colour(crop):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

    red_mask1 = cv2.inRange(hsv, (0, 70, 50), (10, 255, 255))
    red_mask2 = cv2.inRange(hsv, (170, 70, 50), (180, 255, 255))
    red_mask = red_mask1 + red_mask2
    amber_mask = cv2.inRange(hsv, (15, 50, 50), (45, 255, 255))
    green_mask = cv2.inRange(hsv, (35, 50, 50), (100, 255, 255))

    red_score = cv2.countNonZero(red_mask)
    amber_score = cv2.countNonZero(amber_mask)
    green_score = cv2.countNonZero(green_mask)

    threshold = 40

    if red_score > max(amber_score, green_score) and red_score > threshold:
        return "red"
    if amber_score > max(red_score, green_score) and amber_score > threshold:
        return "amber"
    if green_score > max(red_score, amber_score) and green_score > threshold:
        return "green"

    h, _ = crop.shape[:2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, bright = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    top = bright[:int(h * 0.6), :]
    bottom = bright[int(h * 0.6):, :]

    if cv2.countNonZero(top) > cv2.countNonZero(bottom):
        return "red"
    if cv2.countNonZero(bottom) > 0:
        return "green"

    return "unknown"


def detect_signal(image_bytes):
    img = cv2.imdecode(
        np.frombuffer(image_bytes, np.uint8),
        cv2.IMREAD_COLOR
    )

    if img is None:
        return DetectionResult("unknown", 0.0)

    results = model(img, save=False)

    best = None
    for r in results:
        for box, score, cls in zip(r.boxes.xyxy, r.boxes.conf, r.boxes.cls):
            if int(cls) == 9:
                if best is None or score > best[1]:
                    best = (box, float(score))

    if best is None:
        return DetectionResult("unknown", 0.0)

    crop = img[
        int(best[0][1]):int(best[0][3]),
        int(best[0][0]):int(best[0][2])
    ]

    state = infer_light_colour(crop)
    return DetectionResult(state, best[1])
