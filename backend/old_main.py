# main.py

from flask import Flask, request, send_file
# from ultralytics import YOLO
import cv2
import numpy as np
import random
import io
from roboflow import Roboflow
import supervision as sv
import os

# Initialize Roboflow model
rf = Roboflow(api_key=os.environ["ROBOFLOW_API_KEY"])
project = rf.workspace().project("traffic-light-v9orl")
model = project.version(3).model

# Initialize Flask app
app = Flask(__name__)

# # Load YOLOv8 model (nano for speed)
# model = YOLO('yolov8n.pt')  # change to 'yolov8s.pt' or custom weights if fine-tuned

def infer_light_colour(crop):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

    # Masks
    red_mask1 = cv2.inRange(hsv, (0, 70, 50), (10, 255, 255))
    red_mask2 = cv2.inRange(hsv, (170, 70, 50), (180, 255, 255))
    red_mask = red_mask1 + red_mask2
    amber_mask = cv2.inRange(hsv, (15, 50, 50), (45, 255, 255))
    green_mask = cv2.inRange(hsv, (35, 50, 50), (100, 255, 255))

    red_score = cv2.countNonZero(red_mask)
    amber_score = cv2.countNonZero(amber_mask)
    green_score = cv2.countNonZero(green_mask)

    threshold = 40

    # Standard check first
    if red_score > max(amber_score, green_score) and red_score > threshold:
        return "red"
    if amber_score > max(red_score, green_score) and amber_score > threshold:
        return "amber"
    if green_score > max(red_score, amber_score) and green_score > threshold:
        return "green"

    # --- Fallback: positional heuristic ---
    h, w = crop.shape[:2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Threshold to select "bright" pixels
    _, bright_mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # Split into top 60% (red), bottom 40% (green)
    top = bright_mask[:int(h*0.6), :]
    bottom = bright_mask[int(h*0.6):, :]

    top_count = cv2.countNonZero(top)
    bottom_count = cv2.countNonZero(bottom)

    # Decide based on which region has more bright pixels
    if top_count > bottom_count:
        return "red"
    elif bottom_count > 0:  # green present
        return "green"
    else:
        return ""  # unknown

    # Optional: if still ambiguous
    return ""

def detect_and_annotate(img, confidence_threshold=35):
    # Run Roboflow hosted model
    result = model.predict(img, confidence=confidence_threshold, overlap=30).json()
    preds = result.get("predictions", [])

    if not preds:
        return img

    # Map classes to integers for supervision
    class_name_to_idx = {"Red": 0, "Yellow": 1, "Green": 2}

    # convert predictions to supervision format
    xyxy = []
    confidences = []
    class_ids = []

    for pred in preds:
        x = pred["x"]
        y = pred["y"]
        w = pred["width"]
        h = pred["height"]
        conf = pred["confidence"]
        cls = pred["class"]

        x1 = int(x - w/2)
        y1 = int(y - h/2)
        x2 = int(x + w/2)
        y2 = int(y + h/2)

        xyxy.append([x1, y1, x2, y2])
        confidences.append(conf)
        class_ids.append(class_name_to_idx[cls])

    detections = sv.Detections(
        xyxy=np.array(xyxy),
        confidence=np.array(confidences),
        class_id=np.array(class_ids)
    )

    label_annotator = sv.LabelAnnotator()
    annotated_frame = label_annotator.annotate(scene=img, detections=detections)
    return annotated_frame

# Route to handle uploaded images
@app.route('/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return "No image uploaded", 400

    file = request.files['image']
    img = cv2.imdecode(np.frombuffer(file.read(), np.uint8), cv2.IMREAD_COLOR)
    annotated = detect_and_annotate(img)

    # Convert BGR -> JPEG in memory
    _, buffer = cv2.imencode('.jpg', annotated)
    io_buf = io.BytesIO(buffer)

    return send_file(io_buf, mimetype='image/jpeg')

@app.route('/detect_video', methods=['GET'])
def detect_video():
    for i in range(15, 16):
        input_path = f"test_videos/tv{i}.mp4"
        output_path = f"result{i}.mp4"

        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            return "Could not open video file", 500

        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        out = cv2.VideoWriter(
            output_path,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (width, height)
        )

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            out.write(detect_and_annotate(frame))

        cap.release()
        out.release()
        
        print(f"Processed and saved {input_path}")

    return "Videos processed and saved", 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
