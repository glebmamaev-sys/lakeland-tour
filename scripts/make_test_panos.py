# Генерирует тестовые equirectangular-панорамы (2:1) для отладки панорамного тура.
# Запуск: python3 scripts/make_test_panos.py  → public/panos/villa1_*.jpg
# Один файл делается в стерео top-bottom (как 3D-режим Twinmotion), чтобы проверить VR-ветку.
from PIL import Image, ImageDraw, ImageFont
import math, os

W, H = 4096, 2048
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "panos")
os.makedirs(OUT, exist_ok=True)

ROOMS = [
    ("villa1_01_entrance", "Вход",            (118, 160, 205), (196, 176, 140), [("Гостиная", 0), ("Терраса", 150)]),
    ("villa1_02_living",   "Гостиная",        (122, 168, 212), (214, 204, 186), [("Вход", 180), ("Кухня", 60), ("Терраса", -70)]),
    ("villa1_03_kitchen",  "Кухня-столовая",  (130, 172, 214), (230, 224, 210), [("Гостиная", -120), ("Терраса", 20)]),
    ("villa1_04_bedroom",  "Спальня 1",       (110, 150, 200), (222, 208, 184), [("Гостиная", 180)]),
    ("villa1_05_terrace",  "Терраса, бассейн",(96, 170, 220), (120, 160, 90),  [("Гостиная", 180), ("Кухня", -150), ("Спальня 1", 100)]),
]

def font(size):
    for p in ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

F_BIG, F_MID, F_SMALL = font(170), font(80), font(56)

def draw_pano(name, title, sky, ground, doors):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    # небо: градиент к горизонту; земля: градиент к низу
    for y in range(H // 2):
        t = y / (H / 2)
        c = tuple(int(sky[i] * (1 - t) + 235 * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    for y in range(H // 2, H):
        t = (y - H / 2) / (H / 2)
        c = tuple(int(ground[i] * (1 - 0.35 * t)) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # горизонт и меридианы каждые 30°, подписи азимута (0° = центр картинки)
    d.line([(0, H // 2), (W, H // 2)], fill=(90, 90, 90), width=4)
    for k in range(-6, 7):
        deg = k * 30
        x = int(W / 2 + deg / 360 * W)
        if 0 <= x < W:
            d.line([(x, 0), (x, H)], fill=(255, 255, 255) if deg == 0 else (160, 160, 160), width=6 if deg == 0 else 2)
            d.text((x + 12, H // 2 + 16), f"{deg:+d}°", fill=(40, 40, 40), font=F_SMALL)
    # «двери» в сторону переходов
    for label, deg in doors:
        x = int(W / 2 + deg / 360 * W) % W
        d.rectangle([x - 150, H // 2 - 420, x + 150, H // 2 + 10], fill=(70, 50, 35), outline=(30, 20, 10), width=8)
        d.text((x - 140, H // 2 - 520), f"→ {label}", fill=(20, 20, 20), font=F_MID)
    # заголовок комнаты в центре и по бокам (чтобы читался при любом повороте)
    for x in (W // 2, W // 2 - W // 3, W // 2 + W // 3):
        d.text((x, H // 2 - 760), f"{title}", fill=(25, 25, 25), font=F_BIG, anchor="mm")
        d.text((x, H // 2 - 620), "ТЕСТОВАЯ ПАНОРАМА · Lake Land · Villa №1", fill=(60, 60, 60), font=F_SMALL, anchor="mm")
    d.text((W // 2, H - 160), "зенит выше · надир ниже", fill=(230, 230, 230), font=F_SMALL, anchor="mm")
    return img

for name, title, sky, ground, doors in ROOMS:
    img = draw_pano(name, title, sky, ground, doors)
    img.save(os.path.join(OUT, name + ".jpg"), quality=82)
    print("ok", name)

# стерео-вариант гостиной: верх — левый глаз, низ — правый (сдвиг 0.6 % ширины для ощущения глубины)
mono = Image.open(os.path.join(OUT, "villa1_02_living.jpg"))
shift = int(W * 0.006)
right = Image.new("RGB", (W, H)); right.paste(mono, (shift, 0)); right.paste(mono.crop((W - shift, 0, W, H)), (0, 0))
st = Image.new("RGB", (W, H * 2)); st.paste(mono, (0, 0)); st.paste(right, (0, H))
st.save(os.path.join(OUT, "villa1_02_living_3d.jpg"), quality=82)
print("ok villa1_02_living_3d (stereo top-bottom)")
