/**
 * ============================================================================
 * dsh-vs-game —— 文件扩展名 → 敌人种类 映射表
 * ============================================================================
 *
 * host 半使用：解析 tool/call 的 file_path，决定刷哪种文件怪。
 * 敌人属性表（ENEMY_TYPES）在 client 半内联（浏览器侧渲染用），
 * 这里的 type key 必须与 client 的 ENEMY_TYPES 键一一对应。
 */

/** 扩展名（不含点）→ 敌人种类 key */
export const ENEMY_BY_EXTENSION = new Map([
  // tier 0 —— 杂鱼/文档
  ['md', 'docs'], ['mdx', 'docs'], ['txt', 'docs'], ['rst', 'docs'], ['adoc', 'docs'],
  ['json', 'config'], ['yaml', 'config'], ['yml', 'config'], ['toml', 'config'],
  ['ini', 'config'], ['env', 'config'], ['lock', 'config'],
  // tier 1 —— 常见脚本
  ['js', 'js'], ['jsx', 'js'], ['mjs', 'js'], ['cjs', 'js'],
  ['sh', 'shell'], ['bash', 'shell'], ['zsh', 'shell'], ['ps1', 'shell'], ['bat', 'shell'], ['cmd', 'shell'],
  ['py', 'py'], ['pyw', 'py'], ['ipynb', 'py'],
  // tier 2 —— 强类型/前端/后端
  ['ts', 'ts'], ['tsx', 'ts'], ['cts', 'ts'], ['mts', 'ts'],
  ['html', 'html'], ['htm', 'html'], ['css', 'html'], ['scss', 'html'], ['less', 'html'], ['vue', 'html'], ['svelte', 'html'],
  ['go', 'go'], ['java', 'go'], ['kt', 'go'], ['cs', 'go'], ['php', 'go'], ['rb', 'go'], ['swift', 'go'],
  // tier 3 —— 硬骨头
  ['rs', 'rs'], ['c', 'rs'], ['h', 'rs'], ['cpp', 'rs'], ['cc', 'rs'], ['hpp', 'rs'],
  ['exe', 'bin'], ['dll', 'bin'], ['so', 'bin'], ['bin', 'bin'], ['wasm', 'bin'], ['jar', 'bin'],
  ['sql', 'term'], ['db', 'term'], ['sqlite', 'term'],
]);

/** 工具名分类：文件工具 / 终端工具 / 搜索工具 */
export function classifyTool(name) {
  const n = String(name || '').toLowerCase();
  if (/^(read|write|edit|read_image|notebookedit)$/.test(n)) return 'file';
  if (/(bash|shell|exec|terminal|subprocess|run)/.test(n)) return 'term';
  if (/(glob|grep|search|web|fetch|find|list)/.test(n)) return 'search';
  return null;
}

/** 从 file_path 提取敌人种类 key（未知扩展名 → 杂鱼 misc） */
export function enemyTypeOfPath(filePath) {
  const p = String(filePath || '');
  const dot = p.lastIndexOf('.');
  if (dot < 0 || dot === p.length - 1) return 'misc';
  const ext = p.slice(dot + 1).toLowerCase();
  return ENEMY_BY_EXTENSION.get(ext) ?? 'misc';
}
