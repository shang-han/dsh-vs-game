# -*- coding: utf-8 -*-
"""
mv-item.jpg → 去黑底透明 PNG → 32px 网格裁切成独立图标
背景规则：与图像边缘连通的"近黑"像素视为背景；
保留描边：紧贴非黑前景的黑壳不擦（RPG Maker 图标普遍有深色描边）。
"""
import os, json
import numpy as np
from PIL import Image
from collections import deque

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets', 'items', 'mv-item.jpg')
SHEET_OUT = os.path.join(ROOT, 'assets', 'items', 'mv-item.png')
TILE_DIR = os.path.join(ROOT, 'assets', 'items', 'mv')
S = 32
BLACK_TOL = 72   # R+G+B 低于此视为近黑（JPG 噪声容差）

# 已人工验证对齐的裁切坐标（原图像素，32px 网格）
CELLS = {
    'chest-gold': (164, 2936), 'chest-blue': (196, 2936),
    'acc-ring': (100, 2936), 'mat-coinpile': (260, 2936),
    'mat-bundle': (132, 2936), 'tool-pick': (228, 2936),
    'box-gift': (292, 2936), 'tent': (196, 2968),
    'rune-purple': (228, 3000), 'rune-blue': (260, 3000),
    'rune-red': (292, 3000), 'mat-scroll': (132, 3000),
    'mat-ingot-silver': (100, 2904), 'mat-ingot-aqua': (132, 2904),
    'mat-ingot-blue': (164, 2904), 'mat-ingot-purple': (196, 2904),
    'mat-ingot-rose': (228, 2904), 'mat-ingot-green': (260, 2904),
    'acc-medal-red': (160, 2816), 'acc-medal-blue': (192, 2816),
    'acc-medal-green': (224, 2816), 'acc-boots': (96, 2816),
    'acc-shield': (96, 2848), 'acc-grail': (128, 2848),
    'acc-lute': (160, 2848), 'acc-flute': (192, 2848),
    'acc-horn': (224, 2848), 'acc-unicorn-horn': (256, 2848),
    'acc-conch': (96, 2880), 'acc-uni-head': (160, 2880),
}


def dilate(mask):
    p = np.pad(mask, 1, constant_values=False)
    return (p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, 1:-1] | p[2:, 1:-1])


def main():
    im = Image.open(SRC).convert('RGB')
    a = np.asarray(im).astype(np.int32)
    h, w, _ = a.shape
    near_black = a.sum(axis=2) < BLACK_TOL

    # 边缘连通的近黑 = 背景
    bg = np.zeros((h, w), dtype=bool)
    dq = deque()
    seed = np.zeros((h, w), dtype=bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    start = near_black & seed
    bg[start] = True
    dq = deque(zip(*np.where(start)))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_black[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))

    # 保留描边壳：背景像素若贴邻前景则保留
    fg = ~bg
    bg_eroded = bg & ~dilate(fg)
    alpha = np.where(bg_eroded, 0, 255).astype(np.uint8)

    rgba = np.dstack([np.clip(a, 0, 255).astype(np.uint8), alpha])
    sheet = Image.fromarray(rgba, 'RGBA')
    sheet.save(SHEET_OUT)
    print('sheet saved: %s (%.2f MB transparent)' % (
        os.path.basename(SHEET_OUT), os.path.getsize(SHEET_OUT) / 1e6))

    os.makedirs(TILE_DIR, exist_ok=True)
    manifest = {}
    for name, (x, y) in CELLS.items():
        tile = sheet.crop((x, y, x + S, y + S))
        # 裁掉四周全透明的空边（保留对称边距，避免图块抖动）
        path = os.path.join(TILE_DIR, name + '.png')
        tile.save(path)
        manifest[name] = 'assets/items/mv/%s.png' % name
    with open(os.path.join(TILE_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('tiles re-cut from transparent sheet:', len(manifest))


if __name__ == '__main__':
    main()
