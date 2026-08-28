# -*- coding: utf-8 -*-
"""
Qwen-Image-2.0 游戏图标批量生成器（scnet.cn OpenAPI）
用法：
  python scripts/gen_icon.py "提示词" [输出文件名]
  python scripts/gen_icon.py --batch batchfile.txt   # 每行: 文件名<TAB>提示词

API key 从 test/apikey.txt 读入内存直接进请求头，绝不打印/落盘。
生成图先落到 assets/items/gen/，人工挑选后再移入正式 assets/。
"""
import sys, os, re, json, time, urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
KEY_FILE = os.path.join(ROOT, '..', 'test', 'apikey.txt')
OUT_DIR = os.path.join(ROOT, 'assets', 'items', 'gen')
API_URL = 'https://api.scnet.cn/api/llm/v1/images/generations'

STYLE_LOCK = (
    'Q版动漫游戏道具图标，深海蓝配色，金色装饰细节，居中构图，'
    '柔和光晕，纯净浅灰色背景，高细节手游装备图标风格，无文字，无水印'
)
NEG = '低分辨率，低画质，画面过饱和，AI感，文字，水印，复杂背景，阴影裁切不完整'


def read_key():
    raw = open(KEY_FILE, encoding='utf-8', errors='ignore').read()
    m = re.search(r'(sk-[A-Za-z0-9_\-]{8,}|[A-Za-z0-9]{20,}?\.[A-Za-z0-9_\-]{10,})', raw)
    if m:
        return m.group(1)
    # 兜底：取非 URL 的最长一行
    lines = [l.strip() for l in raw.splitlines() if l.strip() and 'http' not in l]
    return max(lines, key=len)


def gen(prompt, out_name):
    key = read_key()
    payload = {
        'model': 'Qwen-Image-2.0',
        'input': {'prompt': prompt + '。' + STYLE_LOCK},
        'parameters': {
            'negative_prompt': NEG,
            'prompt_extend': False,
            'watermark': False,
            'size': '1024*1024',
            'n': 1,
            'seed': 20260828,
        },
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode('utf-8'), headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
    })
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = json.loads(resp.read().decode('utf-8'))
    status = (body.get('output') or {}).get('task_status')
    results = (body.get('output') or {}).get('results') or []
    urls = [r if isinstance(r, str) else (r.get('url') or r.get('image_url')) for r in results]
    urls = [u for u in urls if u]
    if status != 'succeeded' or not urls:
        # 只输出排障所需的安全字段
        safe = {k: body.get(k) for k in ('request_id',)}
        print(json.dumps({'task_status': status, 'urls': 0, **safe}, ensure_ascii=False))
        return False
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, out_name if out_name.endswith('.png') else out_name + '.png')
    with urllib.request.urlopen(urls[0], timeout=120) as img:
        data = img.read()
    open(path, 'wb').write(data)
    print(json.dumps({'ok': path, 'bytes': len(data), 'sec': round(time.time() - t0, 1)}, ensure_ascii=False))
    return True


if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == '--batch':
        ok = fail = 0
        for line in open(args[1], encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            name, _, prompt = line.partition('\t')
            if gen(prompt.strip(), name.strip()):
                ok += 1
            else:
                fail += 1
            time.sleep(1)
        print('batch done: ok=%d fail=%d' % (ok, fail))
    elif args:
        gen(args[0], args[1] if len(args) > 1 else 'test-icon')
    else:
        print(__doc__)
