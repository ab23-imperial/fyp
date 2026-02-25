import numpy as np
import cv2
import os

ADVICE_STYLE = {
    "arrive_before_green": ("ARRIVE BEFORE GREEN", (0, 0, 255)),
    "arrive_during_green": ("ARRIVE DURING GREEN", (0, 255, 0)),
    "arrive_after_green": ("ARRIVE AFTER GREEN", (0, 165, 255)),
    "no_advice": ("NO DATA", (80, 80, 80)),
}

class SignalUI:
    def __init__(self, width=400, height=700):
        self.width = width
        self.height = height

        cv2.namedWindow("Driver Advisory", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Driver Advisory", self.width, self.height)

        # Try loading assets
        self.road_img = self.load_image("ui/lib/road2.png")
        self.car_img = self.load_image("ui/lib/car.png", alpha=True)

    def load_image(self, path, alpha=False):
        if not os.path.exists(path):
            return None

        if alpha:
            img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        else:
            img = cv2.imread(path)

        return img

    def overlay_png(self, background, png, x, y):
        """Overlay transparent PNG onto background"""
        h, w = png.shape[:2]

        if png.shape[2] == 4:
            alpha = png[:, :, 3] / 255.0
            for c in range(3):
                background[y:y+h, x:x+w, c] = (
                    alpha * png[:, :, c] +
                    (1 - alpha) * background[y:y+h, x:x+w, c]
                )
        else:
            background[y:y+h, x:x+w] = png
            
    def resize_cover(self, img, target_w, target_h):
      h, w = img.shape[:2]

      scale = max(target_w / w, target_h / h)
      new_w = int(w * scale)
      new_h = int(h * scale)

      resized = cv2.resize(img, (new_w, new_h))

      # center crop
      x_start = (new_w - target_w) // 2
      y_start = (new_h - target_h) // 2

      return resized[y_start:y_start+target_h,
                    x_start:x_start+target_w]

    def update(self, advice, window_index=None, delta=None,
              distance=None, eta=None,
              phase_position=None,
              green_dur=None,
              amber_dur=None,
              red_dur=None,
              red_before_dur=None,
              red_after_dur=None):
        text, colour = ADVICE_STYLE.get(advice, ("NO ADVICE", (80, 80, 80)))

        # ---------------- BACKGROUND ----------------
        if self.road_img is not None:
          stretch_factor = 1.5
          stretched = cv2.resize(
              self.road_img,
              (self.width, int(self.height * stretch_factor))
          )

          extra_height = stretched.shape[0] - self.height

          # offset controls vertical displacement
          offset_ratio = 0.3   # 0 = top, 1 = bottom, 0.5 = center
          start_y = int(extra_height * offset_ratio)

          frame = stretched[start_y:start_y + self.height, :]
        else:
          frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
          frame[:] = (30, 30, 30)

        font = cv2.FONT_HERSHEY_SIMPLEX
        thickness = 2

        # ---------------- VERTICAL DRIVER WINDOW ----------------
        if delta is not None and green_dur is not None:

            bar_width = 120
            bar_x = (self.width - bar_width) // 2

            bar_top = int(0)
            bar_bottom = int(self.height)
            bar_height = bar_bottom - bar_top

            if red_before_dur is None:
              red_before_dur = green_dur
            if red_after_dur is None:
                red_after_dur = green_dur

            total_window = red_before_dur + green_dur + red_after_dur

            red1_height = int(bar_height * (red_before_dur / total_window))
            green_height = int(bar_height * (green_dur / total_window))
            red2_height = bar_height - red1_height - green_height

            overlay = frame.copy()
            alpha = 0.4 

            # TOP RED (arrive too early)
            cv2.rectangle(overlay,
                          (bar_x, bar_top),
                          (bar_x + bar_width, bar_top + red1_height),
                          (0, 0, 255), -1)

            # GREEN
            cv2.rectangle(overlay,
                          (bar_x, bar_top + red1_height),
                          (bar_x + bar_width, bar_top + red1_height + green_height),
                          (0, 255, 0), -1)

            # BOTTOM RED (arrive too late)
            cv2.rectangle(overlay,
                          (bar_x, bar_top + red1_height + green_height),
                          (bar_x + bar_width, bar_bottom),
                          (0, 0, 255), -1)

            # formula: frame = (overlay * alpha) + (frame * (1 - alpha))
            cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

            # ---- Corrected normalization ----
            top_bound = -red_before_dur
            bottom_bound = green_dur + red_after_dur

            clamped = max(top_bound, min(delta, bottom_bound))
            pos_ratio = (clamped - top_bound) / (bottom_bound - top_bound)

            # IMPORTANT: remove inversion
            marker_y = int(bar_top + bar_height * pos_ratio)

            # ---------------- CAR MARKER ----------------
            if self.car_img is not None:
                car = cv2.resize(self.car_img, (60, 100))
                car_h, car_w = car.shape[:2]
                car_x = (self.width - car_w) // 2
                car_y = marker_y - car_h // 2

                # Boundary safety
                car_y = max(0, min(self.height - car_h, car_y))
                self.overlay_png(frame, car, car_x, car_y)
            else:
                # fallback rectangle
                cv2.rectangle(frame,
                              (bar_x - 20, marker_y - 10),
                              (bar_x + bar_width + 20, marker_y + 10),
                              (255, 255, 255), -1)

        # ---------------- TEXT ----------------
        cv2.putText(frame, text,
                    (20, 40),
                    font, 0.8, colour,
                    thickness, cv2.LINE_AA)

        if distance is not None and eta is not None:
            telemetry = f"{distance:.0f}m | ETA {eta:.2f}s"
            cv2.putText(frame, telemetry,
                        (20, self.height - 30),
                        font, 0.7, (255, 255, 255),
                        thickness, cv2.LINE_AA)

        cv2.imshow("Driver Advisory", frame)
        cv2.waitKey(1)

    def close(self):
        cv2.destroyAllWindows()
