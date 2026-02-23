import numpy as np
import cv2

ADVICE_STYLE = {
    "arrive_before_green": ("ARRIVE BEFORE GREEN", (0, 0, 255)),
    "arrive_during_green": ("ARRIVE DURING GREEN", (0, 255, 0)),
    "arrive_after_green": ("ARRIVE AFTER GREEN", (0, 165, 255)),
    "no_advice": ("NO DATA", (80, 80, 80)),
}

class SignalUI:
    def __init__(self, width=600, height=300):
        self.width = width
        self.height = height

        cv2.namedWindow("Driver Advisory", cv2.WINDOW_NORMAL)  # Resizable
        cv2.resizeWindow("Driver Advisory", self.width, self.height)
        # Removed fullscreen

    def update(self, advice, window_index=None, delta=None):
        text, colour = ADVICE_STYLE.get(advice, ("NO ADVICE", (80, 80, 80)))
        text = f"{text}\n WIN: {window_index}  Δ: {delta:.2f}s"

        # Create a blank frame
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        frame[:] = colour

        # Dynamically scale font based on window size
        font_scale = self.height / 350
        thickness = max(2, int(self.height / 100))

        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
        text_x = (self.width - text_size[0]) // 2
        text_y = (self.height + text_size[1]) // 2

        cv2.putText(frame, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

        cv2.imshow("Driver Advisory", frame)
        cv2.waitKey(1)
