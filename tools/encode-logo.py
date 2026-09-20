"""Emit src/client/logo.js: the two marks as ASCII base64 data URIs.

The browser bundle must be pure ASCII (it is inlined into a template literal and served with a
plain charset), so a PNG cannot be committed as bytes — it travels as base64. Generated rather than
hand-pasted so the payload can be regenerated from the source art at any time:

    python tools/make-logo.py && python tools/encode-logo.py

The two marks are one brand in two states, which is why they are keyed by THEME rather than by
light/dark filenames: `echocat-LOGO-x1.png` is the open-eye mark for the LIGHT theme and
`echocat-LOGO-闭眼-x1.png` is the closed-eye one for DARK. The plugin picks by theme, so the
caller never needs to know which file is which.
"""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "src", "client", "logo.js")

PAIRS = [
    ("light", os.path.join(HERE, "logo-out", "logo-light.png")),
    ("dark", os.path.join(HERE, "logo-out", "logo-dark.png")),
]

payloads = []
for theme, path in PAIRS:
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} — run tools/make-logo.py first")
    with open(path, "rb") as handle:
        raw = handle.read()
    payloads.append((theme, base64.b64encode(raw).decode("ascii"), len(raw)))

for _, b64, _ in payloads:
    bad = [c for c in b64 if ord(c) > 127]
    if bad:
        raise SystemExit("base64 contained a non-ASCII byte, which cannot happen")

lines = [
    "// EchoCat mark, inlined as base64 data URIs. GENERATED - see tools/encode-logo.py.",
    "//",
    "// Why data URIs and not files: the browser half ships as ONE artifact (lib/client.js) that is",
    "// inlined into a template literal and must stay pure ASCII, so an image cannot travel beside it",
    "// as bytes. Why not an <img src=logo.png>: a plugin cannot serve static assets over the host's",
    "// /api fence, and a data URI needs no request at all.",
    "//",
    "// The mark is picked by THEME, not by file: the open-eye mark belongs to the light theme and the",
    "// closed-eye one to the dark theme, which is a brand decision rather than a brightness one.",
    "const LOGO_BY_THEME = Object.freeze({",
]
for theme, b64, size in payloads:
    lines.append(f"  // {theme}: {size} bytes of PNG")
    lines.append(f"  {theme}: 'data:image/png;base64,{b64}',")
lines.append("})")
lines.append("")
lines.append("module.exports = { LOGO_BY_THEME }")
lines.append("")

with open(OUT, "w", encoding="ascii", newline="\n") as handle:
    handle.write("\n".join(lines))

total = sum(len(b64) for _, b64, _ in payloads)
print(f"wrote {OUT}")
print(f"  {len(payloads)} marks, {total/1024:.1f}KB of base64, {os.path.getsize(OUT)/1024:.1f}KB file")
