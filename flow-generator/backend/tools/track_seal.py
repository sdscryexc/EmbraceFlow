#!/usr/bin/env python3
"""Generate overlay keyframes that follow the seal movement.

How it works
- Applies the same scale/crop as ffmpeg does for the base clip (square -> 1080x1920)
- Runs template matching against a user-provided template crop of the seal
- Outputs keyframes with x/y positions in 1080x1920 coordinates

Typical usage
1) Grab a frame where the seal is clearly visible
   ffmpeg -y -i assets/seal.mp4 -vf "select='eq(n,300)'" -vsync 0 assets/seal_frame.png
2) Crop a tight template around the seal into assets/seal_template.png
3) Generate keyframes
   python3 tools/track_seal.py --video assets/seal.mp4 --template assets/seal_template.png --out assets/seal_track.json

Notes
- This is intentionally simple; if tracking fails, try a better template crop.
- You can tune --every, --offset-x, --offset-y, and --scale.
"""

import argparse
import json
import math
from pathlib import Path

import cv2


def to_canvas(frame_bgr):
    """Match ffmpeg base transform (server.js).

    We *pad* to 1080x1920 instead of cropping so the seal (which swims near edges)
    stays visible.
    FFmpeg: scale=1080:-1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2
    """
    h, w = frame_bgr.shape[:2]
    target_w, target_h = 1080, 1920

    scale = target_w / w
    new_w = target_w
    new_h = int(round(h * scale))
    resized = cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    canvas = cv2.copyMakeBorder(
        resized,
        top=max(0, (target_h - new_h) // 2),
        bottom=max(0, target_h - new_h - (target_h - new_h) // 2),
        left=0,
        right=0,
        borderType=cv2.BORDER_CONSTANT,
        value=(0, 0, 0),
    )
    # Safety crop in case of rounding.
    return canvas[:target_h, :target_w]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--template", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=float, default=0.25, help="seconds between keyframes")
    ap.add_argument("--fps", type=float, default=60.0, help="source fps (used for time)")
    ap.add_argument("--offset-x", type=float, default=-140.0, help="px offset added to match top-left")
    ap.add_argument("--offset-y", type=float, default=-220.0, help="px offset added to match top-left")
    ap.add_argument("--scale", type=float, default=0.62, help="overlay scale (constant for now)")
    ap.add_argument("--rotate", type=float, default=0.0, help="overlay rotation degrees (constant for now)")
    args = ap.parse_args()

    video = cv2.VideoCapture(args.video)
    if not video.isOpened():
        raise SystemExit(f"Failed to open video: {args.video}")

    tpl = cv2.imread(args.template, cv2.IMREAD_COLOR)
    if tpl is None:
        raise SystemExit(f"Failed to read template: {args.template}")

    tpl = to_canvas(tpl)
    tpl_gray = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    th, tw = tpl_gray.shape[:2]

    # Use normalized cross-correlation.
    method = cv2.TM_CCOEFF_NORMED

    keyframes = []

    every_frames = max(1, int(round(args.every * args.fps)))
    idx = 0
    while True:
        ok, frame = video.read()
        if not ok:
            break
        if idx % every_frames != 0:
            idx += 1
            continue

        canvas = to_canvas(frame)
        gray = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY)

        res = cv2.matchTemplate(gray, tpl_gray, method)
        _min_val, max_val, _min_loc, max_loc = cv2.minMaxLoc(res)

        # If score is too low, skip (keeps previous motion smooth rather than jumping).
        if max_val < 0.35:
            idx += 1
            continue

        x, y = max_loc
        t = idx / args.fps

        keyframes.append(
            {
                "t": round(t, 3),
                "x": round(x + args.offset_x, 2),
                "y": round(y + args.offset_y, 2),
                "s": float(args.scale),
                "r": float(args.rotate),
                "score": round(float(max_val), 3),
            }
        )

        idx += 1

    # Ensure at least two keyframes.
    if len(keyframes) < 2:
        raise SystemExit("Tracking produced <2 keyframes. Try a better template crop.")

    # Drop the non-ffmpeg fields for the renderer.
    cleaned = [{k: f[k] for k in ("t", "x", "y", "s", "r")} for f in keyframes]

    out_path = Path(args.out)
    out_path.write_text(json.dumps(cleaned, indent=2), encoding="utf-8")
    print(f"Wrote {len(cleaned)} keyframes -> {out_path}")


if __name__ == "__main__":
    main()
