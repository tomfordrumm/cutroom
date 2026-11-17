#!/usr/bin/env python3
"""Cutroom vision helpers (OpenCV). Output is JSON on stdout.

  vision.py faces MODEL WIDTH HEIGHT FPS   raw bgr24 frames on stdin -> one JSON line per frame
  vision.py bbox PNG [PNG...]              bounding box of visible pixels of each RGBA PNG
  vision.py carry A B [A B ...]            share of A's content still in place in B, per pair
  vision.py sheet OUT COLS IMG:LABEL ...   contact sheet of pictures with labels under them
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


def _content(gray):
    """Pixels that are not the frame's ground: far from its median value."""
    ground = float(np.median(gray))
    return np.abs(gray.astype(np.int16) - ground) > 28


def carry(files):
    """For each pair (last frame of a scene, first of the next): how much of what
    was on screen is still there. A slide change scores near 0."""
    result = []
    for a_file, b_file in zip(files[0::2], files[1::2]):
        a, b = cv2.imread(a_file, cv2.IMREAD_GRAYSCALE), cv2.imread(b_file, cv2.IMREAD_GRAYSCALE)
        if a is None or b is None:
            result.append(None)
            continue
        width = 160
        a = cv2.resize(a, (width, int(a.shape[0] * width / a.shape[1])), interpolation=cv2.INTER_AREA)
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
        content = _content(a)
        if content.sum() < 20:
            result.append(1.0)
            continue
        kept = (np.abs(a.astype(np.int16) - b.astype(np.int16)) < 22) & content & _content(b)
        result.append(round(float(kept.sum() / content.sum()), 3))
    print(json.dumps(result))


def sheet(out, cols, items):
    cell_w, cell_h, pic = 220, 250, 180
    rows = (len(items) + cols - 1) // cols
    canvas = np.full((rows * cell_h + 20, cols * cell_w + 20, 3), 245, np.uint8)
    for n, item in enumerate(items):
        file, _, label = item.partition(":")
        image = cv2.imread(file, cv2.IMREAD_UNCHANGED)
        if image is None:
            continue
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
        if image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        k = pic / max(image.shape[0], image.shape[1])
        image = cv2.resize(image, (max(1, int(image.shape[1] * k)), max(1, int(image.shape[0] * k))), interpolation=cv2.INTER_AREA)
        x = 10 + (n % cols) * cell_w + (cell_w - image.shape[1]) // 2
        y = 10 + (n // cols) * cell_h + (pic - image.shape[0]) // 2 + 8
        alpha = image[:, :, 3:4].astype(np.float32) / 255
        region = canvas[y:y + image.shape[0], x:x + image.shape[1]]
        region[:] = (image[:, :, :3] * alpha + region * (1 - alpha)).astype(np.uint8)
        text = label[:26]
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)[0]
        cv2.putText(canvas, text, (10 + (n % cols) * cell_w + (cell_w - size[0]) // 2, 10 + (n // cols) * cell_h + pic + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 40), 1, cv2.LINE_AA)
    cv2.imwrite(out, canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(json.dumps({"file": out, "count": len(items)}))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "faces":
        faces(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]))
    elif command == "bbox":
        bbox(sys.argv[2:])
    elif command == "carry":
        carry(sys.argv[2:])
    elif command == "sheet":
        sheet(sys.argv[2], int(sys.argv[3]), sys.argv[4:])
    else:
        sys.exit(__doc__)
