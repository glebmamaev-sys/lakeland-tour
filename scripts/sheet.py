#!/usr/bin/env python3
"""Контактный лист: sheet.py out.jpg cols dir name:label ..."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, cols, d = sys.argv[1], int(sys.argv[2]), sys.argv[3]; items = [a.split(':', 1) for a in sys.argv[4:]]
ims = [(Image.open(os.path.join(d, n + '.jpg')).convert('RGB'), lab) for n, lab in items]
w, h = ims[0][0].size; rows = (len(ims) + cols - 1) // cols; bar = max(22, h // 28)
sheet = Image.new('RGB', (cols * w, rows * h), (0, 0, 0)); dr = ImageDraw.Draw(sheet, 'RGBA')
try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', int(bar * 0.62))
except Exception: font = ImageFont.load_default()
for k, (im, lab) in enumerate(ims):
    x, y = (k % cols) * w, (k // cols) * h; sheet.paste(im.resize((w, h)), (x, y)); dr.rectangle([x, y, x + w, y + bar], fill=(10, 20, 40, 190)); dr.text((x + 8, y + bar * 0.16), lab, fill=(255, 255, 255, 255), font=font)
sheet.save(out, quality=86); print(out)
