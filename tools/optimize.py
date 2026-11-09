#!/usr/bin/env python3
"""Shrink the site's images, fonts and audio in place (same file names, so index.html needs no change).

Safe to run again and again: files it already optimized are recorded in tools/optimized.json
(by content hash) and skipped. Run it after every artifact sync:  python3 tools/optimize.py
"""
import hashlib, io, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "tools", "optimized.json")

# longest side in px for files shown small; everything else is capped by MAX_JPEG_W / MAX_PNG_W
SIZE_OVERRIDES = {
    "janur_icon_white.png": 240,   # logo shown at ~50px
    "janur_logo_white.png": 480,
    "mist_sketch2.jpg": 1200,      # hidden layer
    "nina_ink.png": 900, "sevo_ink.png": 900,
}
MAX_JPEG_W = 1600
MAX_PNG_W = 1400
JPEG_Q = 74
LATIN = ("U+0000-024F,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+1E00-1EFF,"
         "U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def fit(im, limit_long=None, limit_w=None):
    w, h = im.size
    scale = 1.0
    if limit_long and max(w, h) > limit_long:
        scale = limit_long / max(w, h)
    elif limit_w and w > limit_w:
        scale = limit_w / w
    if scale < 1:
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    return im


def jpeg(path, name):
    im = Image.open(path)
    im = im.convert("RGB")
    im = fit(im, SIZE_OVERRIDES.get(name), MAX_JPEG_W)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    return out.getvalue()


def png(path, name):
    im = Image.open(path)
    im = fit(im, SIZE_OVERRIDES.get(name), MAX_PNG_W)
    if im.mode not in ("RGBA", "RGB"):
        im = im.convert("RGBA")
    q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    out = io.BytesIO()
    q.save(out, "PNG", optimize=True)
    return out.getvalue()


def mp3(path, name):
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as t:
        tmp = t.name
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-map_metadata", "-1",
                        "-codec:a", "libmp3lame", "-b:a", "128k", tmp], check=True)
        return open(tmp, "rb").read()
    finally:
        os.remove(tmp)


def font(path, name):
    from fontTools import subset
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    f = subset.load_font(path, opts)
    s = subset.Subsetter(opts)
    s.populate(unicodes=subset.parse_unicodes(LATIN))
    s.subset(f)
    out = io.BytesIO()
    subset.save_font(f, out, opts)
    return out.getvalue()


def main():
    done = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    before = after = 0
    names = sorted(os.listdir(ROOT))
    if os.path.isdir(os.path.join(ROOT, "audio")):
        names += ["audio/" + n for n in sorted(os.listdir(os.path.join(ROOT, "audio")))]
    for name in names:
        path = os.path.join(ROOT, name)
        ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
        if ext not in ("jpg", "jpeg", "png", "ttf", "mp3") or not os.path.isfile(path):
            continue
        data = open(path, "rb").read()
        if done.get(name) == sha(data):
            continue  # already optimized
        try:
            new = {"jpg": jpeg, "jpeg": jpeg, "png": png, "ttf": font, "mp3": mp3}[ext](path, name)
        except Exception as e:
            print(f"skip {name}: {e}", file=sys.stderr)
            continue
        if len(new) < len(data) * 0.95:
            open(path, "wb").write(new)
            before += len(data); after += len(new)
            print(f"{name}: {len(data)//1024} KB -> {len(new)//1024} KB")
            done[name] = sha(new)
        else:
            done[name] = sha(data)
    json.dump(done, open(MANIFEST, "w"), indent=1, sort_keys=True)
    if before:
        print(f"saved {(before-after)//1024} KB")


if __name__ == "__main__":
    main()
