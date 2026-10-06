#!/bin/sh
# Make the small JPEG copies the printable catalogue uses (assets/catalogue/photos/).
# Run after adding product photos; needs ImageMagick. Copies that already exist are kept.
cd "$(dirname "$0")/.." || exit 1
grep -o 'src="/[^"]*"' catalogue/index.html | sed 's/^src="\///; s/"$//' | grep -v '^assets/catalogue/' | grep -E '\.(webp|png|jpe?g)$' | sort -u | while read -r f; do
  out="assets/catalogue/photos/$(echo "$f" | sed 's|\.[a-z]*$||; s|/|-|g').jpg"
  [ -f "$out" ] || convert "$f" -resize '900x900>' -background white -alpha remove -quality 80 "$out"
done
