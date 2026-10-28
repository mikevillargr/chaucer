#!/bin/sh
# Turns full-bleed square artwork into a macOS app icon: 824px rounded square on a
# 1024px transparent canvas (Apple's icon grid) with a soft drop shadow.
#   make-icon.sh <artwork.png> <out.png>
set -eu
in="$1"; out="$2"; tmp=$(mktemp -d)
convert "$in" -resize 824x824^ -gravity center -extent 824x824 "$tmp/art.png"
convert -size 824x824 xc:none -fill white -draw "roundrectangle 0,0,823,823,185,185" "$tmp/mask.png"
convert "$tmp/art.png" "$tmp/mask.png" -alpha off -compose CopyOpacity -composite "$tmp/rounded.png"
convert "$tmp/rounded.png" \( +clone -background black -shadow 35x12+0+10 \) +swap -background none -layers merge +repage "$tmp/shadowed.png"
convert -size 1024x1024 xc:none "$tmp/shadowed.png" -gravity center -geometry +0+4 -composite "$out"
rm -rf "$tmp"
