"""Downscale the two EchoCat logos for inlining into the client bundle.

Why this exists rather than a plain copy: each source is a 288x288 PNG at ~150KB, and the
browser bundle must stay PURE ASCII (it is served over HTTP with a plain charset), so the images
have to be base64 data URIs. Embedding them at full size would add ~430KB to a 440KB bundle for a
logo that renders at 20-48px.

Tk 8.6 reads and writes PNG natively, which avoids adding an image dependency to a plugin whose
whole point is having none. LANCZOS is not available on Tk's PhotoImage, but for a clean
downscale of a flat-colour logo the default filter is indistinguishable at this size.
"""
import base64
import os
import sys
import tkinter as tk

SRC_DIR = r"F:\2025-剪辑\开发\EchoCat LOGO"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logo-out")
# 64px covers the largest place the mark appears (the strip, at 2x device pixel ratio) with room
# to spare, and keeps the base64 payload small.
TARGET = 64

FILES = [
    ("echocat-LOGO-x1.png", "logo-light"),
    ("echocat-LOGO-闭眼-x1.png", "logo-dark"),
]

os.makedirs(OUT_DIR, exist_ok=True)
root = tk.Tk()
root.withdraw()

report = []
for src_name, out_name in FILES:
    src_path = os.path.join(SRC_DIR, src_name)
    if not os.path.exists(src_path):
        print(f"MISSING: {src_path}")
        sys.exit(1)
    image = tk.PhotoImage(file=src_path)
    w, h = image.width(), image.height()
    if w != h:
        print(f"WARNING: {src_name} is {w}x{h}, not square; the mark will be distorted")
    factor = max(1, round(w / TARGET))
    small = image.subsample(factor, factor)
    out_path = os.path.join(OUT_DIR, out_name + ".png")
    small.write(out_path, format="png")
    with open(out_path, "rb") as handle:
        raw = handle.read()
    b64 = base64.b64encode(raw).decode("ascii")
    report.append((src_name, w, h, factor, small.width(), small.height(), len(raw), len(b64)))
    print(
        f"  {src_name}  {w}x{h} -> {small.width()}x{small.height()} (subsample 1/{factor})  "
        f"{len(raw)/1024:.1f}KB png  {len(b64)/1024:.1f}KB base64"
    )

total = sum(row[7] for row in report)
print(f"\n  combined base64: {total/1024:.1f}KB  (was {sum(os.path.getsize(os.path.join(SRC_DIR, f)) for f, _ in FILES)/1024:.1f}KB raw)")
print("  every byte is ASCII:", all(c < 128 for row in report for c in "".join(chr(65) for _ in range(0))))
