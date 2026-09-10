#!/usr/bin/env python3
"""Generate Sonario's app icon set from the brand spec.

The icons are RENDERED rather than exported from a design file, because the mark is the letter S
in the same face as the SONARIO wordmark — so the type is the source of truth and any size can be
produced crisply on demand.

That face is **Big Shoulders Display 900** as of 2026-09-10. It was Oswald Bold until then; Nina's
Figma is the approved visual source of truth, it sets the wordmark as Big Shoulders Display 900,
and the app now renders it that way, so the icons follow rather than leaving the mark and the
wordmark on two different condensed faces. Composition, tile sizes, glyph proportions and colours
are all UNCHANGED from the Oswald version — this was a typography consistency fix only.

    pip3 install pillow
    curl -sL -o /tmp/bsd.ttf "https://github.com/google/fonts/raw/main/ofl/bigshouldersdisplay/BigShouldersDisplay%5Bwght%5D.ttf"
    python3 scripts/make-icons.py /tmp/bsd.ttf

Spec: icon sheet v1.0, Sept 2026. Sonario Purple #7052CD, Lavender #EEE6FF.
The mark's ink was sampled from the branding sheet PNG rather than guessed, because the palette
key states only the purple and lavender. Worth knowing: the sheet uses TWO darks, and they are
not interchangeable — the WORDMARK is near-black #090223 while the S MARK and app icon are a
deeper indigo #1E0355. Sampling the sheet's most common dark pixel gives you the wordmark's,
which is the wrong one for the icon.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

LAVENDER = '#EEE6FF'   # app icon background, per the palette key
INK = '#1E0355'        # the S mark, sampled from the branding sheet's S MARK panel
FONT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bsd.ttf'
WEIGHT = 900           # the wordmark's weight, and the top of Big Shoulders' 100-900 wght axis
SS = 4                 # supersample factor, then downscale: gives clean curves at small sizes


def render(size, *, radius_pct, glyph_pct, opaque_bg=None, weight=WEIGHT):
    """One icon. radius_pct=0 gives square corners; glyph_pct is the S's height as a share of the tile."""
    w = size * SS
    img = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg = opaque_bg or LAVENDER
    if radius_pct:
        d.rounded_rectangle([0, 0, w - 1, w - 1], radius=int(w * radius_pct), fill=bg)
    else:
        d.rectangle([0, 0, w - 1, w - 1], fill=bg)

    # Size the glyph by its INK bounding box, not the font's metrics: these display faces carry a
    # lot of ascent/descent, so centring on metrics leaves the S visibly high in the tile. Sizing
    # on ink height also means the face swap kept every tile's proportions — the S is the same
    # height as the Oswald version was, just Big Shoulders' wider, blockier shape.
    target = w * glyph_pct
    px = int(target * 1.6)
    while True:
        f = ImageFont.truetype(FONT, px)
        f.set_variation_by_axes([weight])
        box = d.textbbox((0, 0), 'S', font=f)
        if box[3] - box[1] <= target or px < 8:
            break
        px -= max(1, px // 40)
    f = ImageFont.truetype(FONT, px)
    f.set_variation_by_axes([weight])
    box = d.textbbox((0, 0), 'S', font=f)
    d.text(((w - (box[2] - box[0])) / 2 - box[0], (w - (box[3] - box[1])) / 2 - box[1]),
           'S', font=f, fill=INK)
    return img.resize((size, size), Image.LANCZOS)


ICONS = [
    # The icon as designed: lavender squircle, mark at ~58% of the tile.
    ('icons/icon-512.png', dict(size=512, radius_pct=0.22, glyph_pct=0.58)),
    ('icons/icon-192.png', dict(size=192, radius_pct=0.22, glyph_pct=0.58)),
    # Maskable: Android crops to a circle, so NO rounded corners (the background must bleed to
    # every edge) and the mark shrinks to sit inside the safe zone rather than being clipped.
    ('icons/icon-maskable-512.png', dict(size=512, radius_pct=0, glyph_pct=0.42)),
    # iOS applies its own rounding and composites transparency against black, so this one is a
    # flat opaque square with square corners.
    ('icons/apple-touch-icon.png', dict(size=180, radius_pct=0, glyph_pct=0.58, opaque_bg=LAVENDER)),
    # Browser tab. Under Oswald these went heavier than the base 700 because a 700 S turned to
    # mush at 32px. Big Shoulders 900 IS the brand weight and the top of its axis, so there is
    # nothing heavier to reach for and nothing lighter is wanted — they just run a larger glyph.
    ('icons/favicon-32.png', dict(size=32, radius_pct=0.2, glyph_pct=0.66)),
    ('icons/favicon-64.png', dict(size=64, radius_pct=0.2, glyph_pct=0.62)),
]

for path, kw in ICONS:
    img = render(**kw)
    if kw.get('opaque_bg'):
        flat = Image.new('RGB', img.size, kw['opaque_bg'])
        flat.paste(img, mask=img.split()[3])
        img = flat
    img.save(path)
    print(f'{path}  {img.size[0]}x{img.size[1]}  {img.mode}')
