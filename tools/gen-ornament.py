# -*- coding: utf-8 -*-
"""Генератор белорусского орнамента для css/by.css.

Узор задан крестиковой сеткой: клетка 1x1 в координатах viewBox.
Клетки одного цвета склеиваются в прямоугольники и выводятся одним
<path> на цвет — поэтому два файла вместе весят ~11 КБ вместо
растровой картинки на сотни килобайт.

    python tools/gen-ornament.py

Перезаписывает img/by-ornament.svg и img/by-band.svg. Запускать нужно
только если меняется сам узор: готовые SVG лежат в репозитории.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'img'

RED, BEI = 'r', 'b'


class Grid:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = [[None] * w for _ in range(h)]

    def put(self, x, y, col):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y][x] = col

    def row(self, y, col):
        for x in range(self.w):
            self.put(x, y, col)

    def stamp(self, cx, cy, art, col):
        h = len(art); w = max(len(r) for r in art)
        x0, y0 = cx - (w - 1) // 2, cy - (h - 1) // 2
        for dy, line in enumerate(art):
            for dx, ch in enumerate(line):
                if ch == 'X':
                    self.put(x0 + dx, y0 + dy, col)

    def rosette(self, cx, cy, rings, col, core=1):
        rmax = max(rings)
        for dy in range(-rmax, rmax + 1):
            for dx in range(-rmax, rmax + 1):
                d = abs(dx) + abs(dy)
                if d <= core or d in rings:
                    self.put(cx + dx, cy + dy, col)

    def frame(self, cx, cy, r, arm, col):
        for sx in (-1, 1):
            for sy in (-1, 1):
                for i in range(arm):
                    self.put(cx + sx * r, cy + sy * (r - i), col)
                    self.put(cx + sx * (r - i), cy + sy * r, col)


def rects(g, col):
    """Клетки -> прямоугольники: горизонтальные пробеги, склеенные по вертикали."""
    open_runs = {}          # (x, w) -> y начала
    out = []
    for y in range(g.h + 1):
        runs = set()
        if y < g.h:
            x = 0
            while x < g.w:
                if g.c[y][x] == col:
                    x0 = x
                    while x < g.w and g.c[y][x] == col:
                        x += 1
                    runs.add((x0, x - x0))
                else:
                    x += 1
        for key in list(open_runs):
            if key not in runs:
                out.append((key[0], open_runs.pop(key), key[1], y - 0))
        for key in runs:
            open_runs.setdefault(key, y)
    # (x, y0, w, y_end) -> (x, y, w, h)
    return [(x, y0, w, ye - y0) for (x, y0, w, ye) in out]


def path(g, col):
    # +0.1 к размеру: соседние прямоугольники перекрываются на десятую
    # долю клетки, иначе антиалиасинг рисует между ними светлые швы.
    d = []
    for x, y, w, h in rects(g, col):
        d.append(f'M{x} {y}h{w}.1v{h}.1h-{w}.1z')
    return ''.join(d)


def svg(g, colors, out):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g.w} {g.h}">']
    for col, hexval in colors:
        p = path(g, col)
        if p:
            parts.append(f'<path fill="{hexval}" d="{p}"/>')
    parts.append('</svg>')
    out.write_text(''.join(parts), encoding='utf-8')
    print(out.name, out.stat().st_size, 'bytes')


# --- мотивы -------------------------------------------------------

# «Рагач» / дрэва жыцця — вертикальный разделитель между розетками
TREE = [
    'X...X', '.X.X.', '..X..', '.XXX.', 'X.X.X', '..X..', '.XXX.',
    'X.X.X', '..X..', '.X.X.', 'X.X.X', '.X.X.', '..X..', 'X.X.X',
    '.XXX.', '..X..', 'X.X.X', '.XXX.', '..X..', '.X.X.', 'X...X',
]
DIAMOND = ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..']
CIRCLE = ['.XXX.', 'X...X', 'X.X.X', 'X...X', '.XXX.']


def band_small(g, y, col):
    """Ряд мелких ромбов, шаг 10. Высота 5."""
    for cx in range(5, g.w, 10):
        g.stamp(cx, y + 2, DIAMOND, col)


def band_mid(g, y):
    """Розетка + кружок, шаг 20. Высота 11."""
    for cx in range(5, g.w, 20):
        g.rosette(cx, y + 5, (3, 5), RED)
    for cx in range(15, g.w, 20):
        g.stamp(cx, y + 5, CIRCLE, RED)


def band_big(g, y):
    """Большая розетка в рамке + «рагач», шаг 30. Высота 21."""
    for cx in range(10, g.w, 30):
        g.rosette(cx, y + 10, (3, 6, 9), RED)
        g.frame(cx, y + 10, 10, 7, RED)
    for cx in range(25, g.w, 30):
        g.stamp(cx, y + 10, TREE, RED)


def sep(g, y):
    """Двойная бежевая линия. Высота 6."""
    g.row(y + 1, BEI)
    g.row(y + 4, BEI)


COLORS = [(RED, '#c8202a'), (BEI, '#e0c894')]

# --- 1. Обойная плитка 60x74: полный рушник, бесшовно по обеим осям ---
t = Grid(60, 74)
band_small(t, 2, BEI)
sep(t, 7)
band_mid(t, 13)
sep(t, 24)
band_big(t, 30)
sep(t, 51)
band_mid(t, 57)
sep(t, 68)
svg(t, COLORS, OUT / 'by-ornament.svg')

# --- 2. Узкая кайма 60x9: под шапку и в подвал ---
b = Grid(60, 9)
b.row(0, BEI)
b.row(8, BEI)
for cx in range(3, b.w, 12):
    b.stamp(cx, 4, DIAMOND, RED)
for cx in range(9, b.w, 12):
    b.stamp(cx, 4, DIAMOND, BEI)
svg(b, COLORS, OUT / 'by-band.svg')
