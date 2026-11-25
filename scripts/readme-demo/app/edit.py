"""Edit the raw Nextbrowser app capture into the README GIF.

Usage: python scripts/readme-demo/app/edit.py <recDir> assets --nav <seconds>
Raw times come from marks.json written by record.mjs. --nav is the raw time when the Live View
leaves the profile start page; until then the local start-page address is masked. The account
initials are always replaced with a neutral avatar. Coordinates assume a 1280x800 window at 125%.
"""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("rec")
ap.add_argument("out")
ap.add_argument("--width", type=int, default=960)
ap.add_argument("--fps", type=float, default=12)
ap.add_argument("--colors", type=int, default=128)
ap.add_argument("--dither", default="bayer:bayer_scale=5")
ap.add_argument("--nav", type=float, default=31.1, help="raw time the Live View leaves the start page")
a = ap.parse_args()

rec, out = Path(a.rec), Path(a.out)
out.mkdir(parents=True, exist_ok=True)
marks = {m["label"]: m["t"] for m in json.loads((rec / "marks.json").read_text())["marks"]}
raw = rec / "raw.mkv"

# Frame-space geometry (physical pixels of the 1280x800 capture).
CROP = (9, 3, 1258, 795)  # x, y, w, h: drop the window's 1-3 px edges where the desktop shows through
AVATAR = (45, 92, 20)  # centre x, centre y, radius
URL_BOX = (268, 178, 284, 28)  # address text of the Live View start page
STOP_BTN = (1218, 735)  # where the pointer rests after sending

probe = rec / "probe.png"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{marks['live-ready'] + 1.0:.2f}", "-i",
                str(raw), "-frames:v", "1", str(probe)], check=True)
frame0 = Image.open(probe).convert("RGB")
work = rec / "edit"
work.mkdir(exist_ok=True)
avatar_rgb = frame0.getpixel((AVATAR[0] - 12, AVATAR[1] + 8))
url_rgb = frame0.getpixel((URL_BOX[0] + URL_BOX[2] - 4, URL_BOX[1] + 3))

# Neutral avatar: same circle colour with a simple person glyph instead of initials.
S = 4
r = AVATAR[2]
img = Image.new("RGBA", (2 * r * S, 2 * r * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse((0, 0, 2 * r * S - 1, 2 * r * S - 1), fill=avatar_rgb + (255,))
c = r * S
d.ellipse((c - 6 * S, c - 11 * S, c + 6 * S, c + 1 * S), fill=(235, 245, 235, 255))
d.pieslice((c - 11 * S, c + 3 * S, c + 11 * S, c + 25 * S), 180, 360, fill=(235, 245, 235, 255))
mask = Image.new("L", img.size, 0)
ImageDraw.Draw(mask).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
img.putalpha(Image.composite(img.getchannel("A"), mask, mask))
img = img.resize((2 * r, 2 * r), Image.LANCZOS)
img.save(work / "avatar.png")

# Pointer matching the in-app demo cursor (20 CSS px at 125% scaling).
size = 25
cur = Image.new("RGBA", (size * S + 8 * S, size * S + 8 * S), (0, 0, 0, 0))
k = size * S / 24
pts = [(5, 3), (19, 11.2), (12.9, 12.5), (16.5, 19.1), (13.8, 20.5), (10.2, 13.8), (5, 18.3)]
poly = [(x * k + 2 * S, y * k + 2 * S) for x, y in pts]
cd = ImageDraw.Draw(cur)
shadow = [(x + 1.5 * S, y + 2 * S) for x, y in poly]
cd.polygon(shadow, fill=(0, 0, 0, 90))
cd.polygon(poly, fill=(255, 255, 255, 255), outline=(17, 17, 17, 255), width=int(1.4 * k))
cur = cur.resize((cur.width // S, cur.height // S), Image.LANCZOS)
cur.save(work / "cursor.png")
tip = (round(5 * k / S + 2), round(3 * k / S + 2))

sent, done = marks["sent"], marks["done"]
# (start, end, speed) in raw seconds.
segments = [
    (marks["start"] + 0.6, marks["type-start"], 1.0),   # Processes, pick the profile, Live View opens
    (marks["type-start"], marks["type-end"], 1.6),     # type the task
    (marks["type-end"], sent + 0.35, 1.0),              # send to Claude Code
    (sent + 0.35, a.nav - 0.3, 8.0),                    # agent works (time-lapse)
    (a.nav - 0.3, done + 0.1, 1.6),                     # Wikipedia opens, answer streams in
    (done + 0.1, done + 3.1, 1.0),                      # hold the result
]

pre = (
    f"[0:v]drawbox=x={URL_BOX[0]}:y={URL_BOX[1]}:w={URL_BOX[2]}:h={URL_BOX[3]}:"
    f"color=0x{url_rgb[0]:02x}{url_rgb[1]:02x}{url_rgb[2]:02x}:t=fill:enable='between(t,4.4,{a.nav})'[m1];"
    f"[m1][1:v]overlay=x={AVATAR[0] - r}:y={AVATAR[1] - r}[m2];"
    f"[m2][2:v]overlay=x={STOP_BTN[0] - tip[0]}:y={STOP_BTN[1] - tip[1]}:enable='between(t,{sent + 0.3},{done + 3.2})'[m3];"
    f"[m3]crop={CROP[2]}:{CROP[3]}:{CROP[0]}:{CROP[1]},split={len(segments)}" + "".join(f"[s{i}]" for i in range(len(segments))) + ";"
)
parts = []
for i, (t0, t1, sp) in enumerate(segments):
    parts.append(f"[s{i}]trim=start={t0:.3f}:end={t1:.3f},setpts=(PTS-STARTPTS)/{sp}[v{i}];")
concat = "".join(f"[v{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=1:a=0,fps={a.fps},scale={a.width}:-2:flags=lanczos,format=rgb24[cat]"
fc = pre + "".join(parts) + concat
total = sum((t1 - t0) / sp for t0, t1, sp in segments)

master0 = work / "cut.mkv"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw), "-i", str(work / "avatar.png"),
                "-i", str(work / "cursor.png"), "-filter_complex", fc, "-map", "[cat]", "-c:v", "ffv1", str(master0)], check=True)

# Dissolve from the answer back to the first frame so the loop has no jump.
fade = 0.5
dur = int(total * a.fps) / a.fps
master = work / "master.mkv"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master0), "-filter_complex",
                f"[0:v]split[a][b];[b]trim=end_frame=1,loop=loop={int(fade * a.fps) + 2}:size=1:start=0,setpts=N/{a.fps}/TB[f];"
                f"[a]trim=duration={dur:.3f},setpts=PTS-STARTPTS[m];[m][f]xfade=transition=fade:duration={fade}:offset={dur - fade:.3f}[v]",
                "-map", "[v]", "-c:v", "ffv1", str(master)], check=True)

gif = out / "nextbrowser-interface-demo.gif"
mp4 = out / "nextbrowser-interface-demo.mp4"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master), "-filter_complex",
                f"split[a][b];[a]palettegen=max_colors={a.colors}:stats_mode=full[p];[b][p]paletteuse=dither={a.dither}:diff_mode=rectangle",
                "-loop", "0", str(gif)], check=True)
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master), "-c:v", "libx264", "-preset", "slow",
                "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-movflags", "+faststart", str(mp4)], check=True)
print(f"duration {dur:.2f}s, gif {gif.stat().st_size // 1024} KiB, mp4 {mp4.stat().st_size // 1024} KiB")
