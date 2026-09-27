# -*- coding: utf-8 -*-
"""
把 qwen 出的一整条精灵图切成游戏能直接用的横向精灵图。

  python scripts/sprite-build.py <源图> <输出.png> --frames 4 [--mode green|white]
        [--height 155] [--canvas 256] [--baseline 232] [--index 0]

  --frames N   源图里横排几格（等分）
  --index i    只导出第 i 格（单帧状态用，比如 idle/carry）
  --height     角色在单帧画布里的高度（游戏内一致性的关键：同角色所有状态用同一个值）
  --baseline   脚底对齐到画布的第几行（也是同角色所有状态要一致）
  --mode green 色度键抠霓虹绿背景（推荐）；white = 只去掉与四边连通的纯白
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage


def key_green(im, t0=18.0, t1=55.0):
    """色度键：G 明显高于 R/B 的判为背景，边缘做软过渡 + 去绿溢"""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    green = np.maximum(0.0, g - np.maximum(r, b))
    alpha = np.clip(1.0 - (green - t0) / (t1 - t0), 0.0, 1.0)
    spill = alpha < 0.999
    g2 = np.where(spill, np.minimum(g, np.maximum(r, b)), g)
    return Image.fromarray(np.dstack([r, g2, b, alpha * 255.0]).astype(np.uint8), 'RGBA')


def key_white(im, thr=232):
    """只去掉与画面四边连通的纯白，保住角色内部的白（围裙/头饰）"""
    a = np.array(im.convert('RGBA'))
    rgb = a[:, :, :3].astype(np.int16)
    bg = (rgb[:, :, 0] >= thr) & (rgb[:, :, 1] >= thr) & (rgb[:, :, 2] >= thr)
    seed = np.zeros_like(bg)
    seed[0, :] = bg[0, :]; seed[-1, :] = bg[-1, :]; seed[:, 0] = bg[:, 0]; seed[:, -1] = bg[:, -1]
    outer = ndimage.binary_propagation(seed, mask=bg)
    out = a.copy()
    out[:, :, 3] = np.where(outer, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def normalize(frame, canvas, height, baseline):
    """按不透明外框缩放到 height，脚底对齐 baseline，水平居中"""
    arr = np.array(frame)
    ys, xs = np.where(arr[:, :, 3] > 16)
    if len(xs) == 0:
        return Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    crop = frame.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    s = height / crop.height
    crop = crop.resize((max(1, round(crop.width * s)), height), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.paste(crop, ((canvas - crop.width) // 2, baseline - height + 1), crop)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--frames', type=int, default=4)
    ap.add_argument('--index', type=int, default=None)
    ap.add_argument('--mode', choices=['green', 'white', 'none'], default='green',
                    help='none = 图里已经有 alpha（比如手工抠好的），只做切分与对齐')
    ap.add_argument('--height', type=int, default=155)
    ap.add_argument('--canvas', type=int, default=256)
    ap.add_argument('--baseline', type=int, default=232)
    a = ap.parse_args()

    src = Image.open(a.src)
    if a.mode == 'green':
        src = key_green(src)
    elif a.mode == 'white':
        src = key_white(src)
    else:
        src = src.convert('RGBA')
    W, H = src.size
    if a.index is not None:
        fw = W // a.frames
        normalize(src.crop((a.index * fw, 0, (a.index + 1) * fw, H)), a.canvas, a.height, a.baseline).save(a.out)
        print('单帧 ->', a.out, (a.canvas, a.canvas))
        return
    fw = W // a.frames
    sheet = Image.new('RGBA', (a.canvas * a.frames, a.canvas), (0, 0, 0, 0))
    for i in range(a.frames):
        sheet.paste(normalize(src.crop((i * fw, 0, (i + 1) * fw, H)), a.canvas, a.height, a.baseline), (i * a.canvas, 0))
    sheet.save(a.out)
    print('%d 帧 ->' % a.frames, a.out, sheet.size)


if __name__ == '__main__':
    main()
