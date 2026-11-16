#!/usr/bin/env python3
"""Cutroom vision helpers (OpenCV). Output is JSON on stdout.

  vision.py faces MODEL WIDTH HEIGHT FPS   raw bgr24 frames on stdin -> one JSON line per frame
  vision.py bbox PNG [PNG...]              bounding box of visible pixels of each RGBA PNG
"""
import json
import sys

import cv2
import numpy as np


def faces(model, width, height, fps):
    detector = cv2.FaceDetectorYN.create(model, "", (width, height), 0.6, 0.3, 20)
    size = width * height * 3
    stream = sys.stdin.buffer
    index = 0
    while True:
        data = stream.read(size)
        if len(data) < size:
            break
        frame = np.frombuffer(data, dtype=np.uint8).reshape((height, width, 3))
        _, found = detector.detect(frame)
        boxes = []
        if found is not None:
            for row in found:
                x, y, w, h = (float(v) for v in row[:4])
                x0, y0 = max(0.0, x), max(0.0, y)
                x1, y1 = min(float(width), x + w), min(float(height), y + h)
                if x1 <= x0 or y1 <= y0:
                    continue
                boxes.append([round(x0 / width, 4), round(y0 / height, 4), round((x1 - x0) / width, 4), round((y1 - y0) / height, 4), round(float(row[14]), 3)])
        boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
        sys.stdout.write(json.dumps({"t": round(index / fps, 3), "faces": boxes}) + "\n")
        index += 1
    sys.stdout.flush()


def bbox(files):
    result = []
    for file in files:
        image = cv2.imread(file, cv2.IMREAD_UNCHANGED)
        if image is None or image.ndim != 3:
            result.append(None)
            continue
        if image.shape[2] == 3:
            # Chrome drops the alpha channel of a fully opaque frame.
            result.append({"width": image.shape[1], "height": image.shape[0], "box": [0, 0, image.shape[1], image.shape[0]]})
            continue
        # Soft shadows and glows are not the element's footprint.
        ys, xs = np.nonzero(image[:, :, 3] > 100)
        if len(xs) == 0:
            result.append({"width": image.shape[1], "height": image.shape[0], "box": None})
        else:
            result.append({"width": image.shape[1], "height": image.shape[0], "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]})
    print(json.dumps(result))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "faces":
        faces(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]))
    elif command == "bbox":
        bbox(sys.argv[2:])
    else:
        sys.exit(__doc__)
