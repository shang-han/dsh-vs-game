/**
 * ============================================================================
 * qwen-image-3.0 出精灵图（同步接口）
 * ============================================================================
 * 用法：
 *   node scripts/qwen-sprite.mjs --ref <参考图.png> [--ref <第二张参考图>…最多 3 张] --prompt <提示词.txt> --out <输出.png>
 *        [--size 2048*512] [--bg green|white] [--key-file <路径>]
 *
 * Key 读取顺序：环境变量 DASHSCOPE_API_KEY → key 文件（默认 E:/DSH/1.txt 的第二行）
 * 严禁把 key 写进仓库。
 *
 * 约定（多次生成踩出来的）：
 *   1. 模型返回的是 JPEG，**没有 alpha 通道**，出图后必须再跑 scripts/sprite-build.py 抠图
 *   2. 背景要**纯霓虹绿**（--bg green 会自动追加这句话），色度键比白底干净、不会误伤白围裙
 *   3. 输出最大边 2048 → 一条横向精灵图最多 4 格 512（想更多动作就分成多张，但同一张里的风格最统一）
 *   4. 每次生成都会重画角色（细节/配色会漂移），同一角色的多个动作尽量放同一张图里
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = {};
const refs = [];
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1];
  if (k === 'ref') refs.push(v); else args[k] = v;
}

const KEY_FILE = args['key-file'] || 'E:/DSH/1.txt';
function loadKey() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  const lines = readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const key = lines.find((l) => l.startsWith('sk-'));
  if (!key) throw new Error('没找到 API key：设 DASHSCOPE_API_KEY 或在 ' + KEY_FILE + ' 里放一行 sk-...');
  return key;
}

const GREEN_TAIL = [
  '**背景必须是纯正的霓虹绿色（chroma key green，接近 #00B140）：整幅背景只有这一种绿色，',
  '不能有渐变、阴影、纹理或其它颜色，角色身上也不要出现绿色**。',
  '画面里不要任何文字、边框、分割线、地面和投影。',
].join('');

if (refs.length === 0 || !args.prompt || !args.out) {
  console.log('用法: node scripts/qwen-sprite.mjs --ref 参考图 [--ref 第二张参考图…最多3张] --prompt 提示词.txt --out 输出.png [--size 2048*512] [--bg green]');
  process.exit(1);
}
const prompt = readFileSync(args.prompt, 'utf8').trim() + ((args.bg ?? 'green') === 'green' ? GREEN_TAIL : '');
const body = {
  model: process.env.QWEN_MODEL || 'qwen-image-3.0',
  input: { messages: [{ role: 'user', content: refs.map((f) => ({ image: 'data:image/png;base64,' + readFileSync(f).toString('base64') })).concat([{ text: prompt }]) }] },
  parameters: { size: args.size || '2048*512', n: 1, prompt_extend: true, watermark: false },
};
const t0 = Date.now();
const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + loadKey(), 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const json = await res.json();
const url = json?.output?.choices?.[0]?.message?.content?.find?.((c) => c.image)?.image;
console.log('HTTP', res.status, '| ' + ((Date.now() - t0) / 1000).toFixed(1) + 's | usage', JSON.stringify(json?.usage ?? {}));
if (!url) { console.log(JSON.stringify(json).slice(0, 800)); process.exit(1); }
writeFileSync(args.out, Buffer.from(await (await fetch(url)).arrayBuffer()));
console.log('已保存', args.out, '→ 接着跑: python scripts/sprite-build.py ' + args.out + ' <输出.png> --frames <格数>');
