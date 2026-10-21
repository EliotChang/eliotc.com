#!/usr/bin/env bash
# Cuts and encodes the media for /sonder into sonder/media/ (gitignored). Upload a new
# dated prefix rather than overwriting, since objects are cached as immutable:
#   aws s3 cp sonder/media s3://worldmap-hero-images-692859942047/eliotc/sonder/<date>/ --recursive \
#     --cache-control "public, max-age=31536000, immutable"   (set --content-type per extension)
# then point sonder/index.html at https://d3h06xb32ojj4n.cloudfront.net/eliotc/sonder/<date>/. Sources are the sonder.gg repo's reels and captures,
# plus .case-study/src for anything pulled from the CDN or recorded fresh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SONDER="${SONDER:-$ROOT/../Figment/sonder.gg}"
SRC="$ROOT/.case-study/src"
OUT="$ROOT/sonder/media"
mkdir -p "$OUT"

# loop <name> <source> <start> <end> [width] [poster-at] [crf]
# Silent, looping H.264 with a WebP poster (first frame unless poster-at is given).
loop() {
  local name=$1 src=$2 ss=$3 to=$4 w=${5:-1600} at=${6:-0} crf=${7:-23}
  ffmpeg -v error -y -ss "$ss" -to "$to" -i "$src" \
    -vf "scale=${w}:-2:flags=lanczos,fps=30" -an \
    -c:v libx264 -preset slow -crf "$crf" -pix_fmt yuv420p -movflags +faststart \
    "$OUT/$name.mp4"
  ffmpeg -v error -y -ss "$at" -i "$OUT/$name.mp4" -frames:v 1 -c:v libwebp -quality 82 "$OUT/$name.webp"
  printf '%-22s %6s KB\n' "$name.mp4" "$(( $(stat -f %z "$OUT/$name.mp4") / 1024 ))"
}

# still <name> <source> [width]
still() {
  local name=$1 src=$2 w=${3:-1600}
  ffmpeg -v error -y -i "$src" -vf "scale='min(${w},iw)':-2:flags=lanczos" -c:v libwebp -quality 84 "$OUT/$name.webp"
  printf '%-22s %6s KB\n' "$name.webp" "$(( $(stat -f %z "$OUT/$name.webp") / 1024 ))"
}

# Act 1: text
still a1-picker "$SONDER/s1.png"
still a1-scene "$SONDER/scratchpad/flash-day/beat1.webp" 1200

# Act 2: visual novel
still a2-bridge "$SONDER/output/playwright/cyoa-current.png"
loop a2-stage "$SONDER/remotion/out/demo/sonder-vn-demo-2026-09-11.mp4" 12.5 50.5
still a2-ios-scene "$SONDER/output/ios-release/screenshots-2026-09-22/iphone-69-05-scene-galileo.png" 800
still a2-ios-deck "$SONDER/output/ios-release/screenshots-2026-09-22/iphone-69-07-deck-galileo.png" 800

# Act 3: film
loop a3-runnymede "$SONDER/remotion/out/minimax/life-film-trailer-v2.mp4" 3.9 16.0 1280 3
loop a3-fork "$SONDER/remotion/out/minimax/life-film-trailer-v2.mp4" 30.4 48.0 1280
loop a3-eeyore-film "$SRC/eeyore-film-opening.mp4" 33.0 62.0 832

# Act 4 recordings (capture/capture.mjs writes <flow>.raw.mp4 at 2x)
[ -e "$SRC/eeyore-read.raw.mp4" ] && loop a4-read "$SRC/eeyore-read.raw.mp4" 0.4 29.5 1440 6 26
[ -e "$SRC/warin-comic.raw.mp4" ] && loop a4-warin "$SRC/warin-comic.raw.mp4" 3.4 17.0 1600 2.5

# Warin of Guildford, Runnymede 1215: the same life in each form (cold open)
# Text: the reading view, cropped to a 16:10 window that pans down the prose to the choices.
if [ -e "$SRC/warin-text.raw.mp4" ]; then
  ffmpeg -v error -y -ss 7.2 -to 21.1 -i "$SRC/warin-text.raw.mp4" \
    -vf "crop=988:618:66:'556+min(1\,max(0\,(t-2.5)/6))*604',scale=1600:-2:flags=lanczos,fps=30" -an \
    -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart "$OUT/w-text.mp4"
  ffmpeg -v error -y -i "$OUT/w-text.mp4" -frames:v 1 -c:v libwebp -quality 84 "$OUT/w-text.webp"
  printf '%-22s %6s KB\n' "w-text.mp4" "$(( $(stat -f %z "$OUT/w-text.mp4") / 1024 ))"
fi
[ -e "$SRC/warin-vn.raw.mp4" ] && loop w-stage "$SRC/warin-vn.raw.mp4" 16.0 33.6 1600 1.0

# speedcut <name> <source> <poster-at> <start:end:speed>...
# Joins segments of a recording; any segment not at 1x carries an "N× speed" badge so a
# compressed wait is never passed off as real time.
speedcut() {
  local name=$1 src=$2 at=$3; shift 3
  local fc="" labels="" i=0
  for seg in "$@"; do
    IFS=: read -r ss to sp <<<"$seg"
    local badge=""
    if [ "$sp" != "1" ]; then
      badge=",drawtext=text='${sp}× speed':x=w-tw-40:y=36:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=14"
    fi
    fc+="[0:v]trim=start=${ss}:end=${to},setpts=(PTS-STARTPTS)/${sp},scale=1600:-2:flags=lanczos,fps=30${badge}[v$i];"
    labels+="[v$i]"
    i=$((i+1))
  done
  fc+="${labels}concat=n=${i}:v=1:a=0[out]"
  ffmpeg -v error -y -i "$src" -filter_complex "$fc" -map "[out]" -an \
    -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
  ffmpeg -v error -y -ss "$at" -i "$OUT/$name.mp4" -frames:v 1 -c:v libwebp -quality 82 "$OUT/$name.webp"
  printf '%-22s %6s KB\n' "$name.mp4" "$(( $(stat -f %z "$OUT/$name.mp4") / 1024 ))"
}

# Act 4: a line of your own, painted live (the wait for words and paint runs at 4x), then Every road.
[ -e "$SRC/eeyore-write.raw.mp4" ] && speedcut a4-write "$SRC/eeyore-write.raw.mp4" 21 \
  1.0:13.0:1 13.0:31.0:4 31.0:44.0:1
# Act 4: a concept comic from /make; the wait for the first panel runs at 4x.
[ -e "$SRC/make-comic.raw.mp4" ] && speedcut a4-make "$SRC/make-comic.raw.mp4" 30 \
  0.5:7.0:1 7.0:21.5:4 21.5:84.0:1
