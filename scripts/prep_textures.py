#!/usr/bin/env python3
"""Готовит текстуры Романа (папки «Мои» и «7_Текстура» в 3D чертежи) для тура:
квадратный кроп, уменьшение до 1024/512, JPG для цвета, WebP для карт нормалей.
Запуск:  python3 -I scripts/prep_textures.py "<папка 3D чертежи>" public/textures
"""
import sys, os, math
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
MY, CL = os.path.join(src, 'Мои'), os.path.join(src, '7_Текстура')

def square(im):
    w, h = im.size; s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))

def color(path, name, size, rotate=0, soften=0.0):
    im = Image.open(path).convert('RGB')
    if rotate: im = im.rotate(rotate, expand=True)
    im = square(im).resize((size, size), Image.LANCZOS)
    # soften — доля смешивания с белым: гасит контраст (штукатурка вблизи иначе выглядит как камуфляж)
    if soften: im = Image.blend(im, Image.new('RGB', im.size, (255, 255, 255)), soften)
    im.save(os.path.join(out, name + '.jpg'), quality=88, optimize=True, progressive=True)
    print(name, im.size, os.path.getsize(os.path.join(out, name + '.jpg')) // 1024, 'KB')

def normal(path, name, size, rotate=0, strength=1.0):
    im = Image.open(path).convert('RGB')
    if rotate: im = im.rotate(rotate, expand=True)
    im = square(im).resize((size, size), Image.LANCZOS)
    # Восстанавливаем Z-канал из X/Y: у «Штукатурка.png» синий канал ≈128 (битая карта — в three.js даёт
    # «камуфляж»), а заодно гасим амплитуду наклонов (strength < 1) для мягкого рельефа.
    out_px = []
    for r, g, _b in im.getdata():
        x = (r / 127.5 - 1.0) * strength; y = (g / 127.5 - 1.0) * strength
        z = math.sqrt(max(0.0, 1.0 - x * x - y * y))
        out_px.append((int((x + 1) * 127.5 + 0.5), int((y + 1) * 127.5 + 0.5), int((z + 1) * 127.5 + 0.5)))
    im = Image.new('RGB', im.size); im.putdata(out_px)
    # нормали — WebP (PNG 1024 весит 1.5 МБ, WebP q90 ~150 КБ; three.js грузит webp во всех современных браузерах)
    im.save(os.path.join(out, name + '_n.webp'), quality=90, method=6)
    print(name + '_n', im.size, os.path.getsize(os.path.join(out, name + '_n.webp')) // 1024, 'KB')

# фасадные рейки СМ Wall «Стоун Грей» (своя текстура Романа + его карта нормалей; рейки вертикальные)
color(os.path.join(MY, 'Фасадная реечная панель СМ Wall 219х26х3000 (Стоун Грей)текстура.jpg'), 'slats', 512)
normal(os.path.join(MY, 'NormalMap.png'), 'slats', 512, strength=0.8)
# орех (пергола/рейки «Дерево Орех» в Revit)
color(os.path.join(CL, 'доска_орех.jpg'), 'walnut', 1024)
# штукатурка: цвет (серая, тонируем в коде) + нормали Романа
color(os.path.join(CL, 'stucco-20-2.jpg'), 'stucco', 512, soften=0.7)
normal(os.path.join(MY, 'Штукатурка.png'), 'stucco', 512, strength=0.35)
# фрагменты стен из камня (акцентные полосы вентфасада)
color(os.path.join(MY, 'Текстура фрагменты стен.jpg'), 'wallstone', 768)
# камень с картой нормалей (площадка у бассейна Виллы №3 — в Revit masonry.stone.ashlar)
color(os.path.join(MY, 'ecbf1363397b853aed8fb8773fd60307.jpg'), 'stone2', 1024)
normal(os.path.join(MY, 'Карта камень.png'), 'stone2', 1024, strength=0.8)
# Не задействованы (нет отдельного меша в экспорте): «Террасная доска» (+нормали), «Текстура подпорной стенки» (+«Подпорная.png»).
# мозаика бассейна Coral-sea (лист 300×300 мм)
color(os.path.join(MY, 'Coral-sea_(стекло)_4_25_25_300_300_Bonaparte.jpg'), 'mosaic', 512)
