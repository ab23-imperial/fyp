import numpy as np
import cv2

ADVICE_STYLE = {
    "slow_down": ("SLOW DOWN", (0, 0, 255)),
    "prepare_to_stop": ("PREPARE TO STOP", (0, 165, 255)),
    "maintain_speed": ("MAINTAIN SPEED", (0, 255, 0)),
    "speed_up": ("SPEED UP", (0, 200, 140)),
    "no_advice": ("NO ADVICE", (80, 80, 80)),
}

class SignalUI:
    def __init__(self, width=600, height=300):
        self.width = width
        self.height = height

        cv2.namedWindow("Driver Advisory", cv2.WINDOW_NORMAL)  # Resizable
        cv2.resizeWindow("Driver Advisory", self.width, self.height)
        # Removed fullscreen

    def update(self, advice):
        text, colour = ADVICE_STYLE.get(advice, ("NO ADVICE", (80, 80, 80)))

        # Create a blank frame
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        frame[:] = colour

        # Dynamically scale font based on window size
        font_scale = self.height / 200
        thickness = max(2, int(self.height / 100))

        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
        text_x = (self.width - text_size[0]) // 2
        text_y = (self.height + text_size[1]) // 2

        cv2.putText(frame, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

        cv2.imshow("Driver Advisory", frame)
        cv2.waitKey(1)
