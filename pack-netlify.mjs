/**
 * 打包给 Netlify 部署的 zip（零依赖，需 Node.js）
 *
 * 用法：
 *   node pack-netlify.mjs
 *
 * 它会：
 *   1. 调用 build.mjs 重新构建 site/
 *   2. 把 site/ 里的文件打包为 netlify-deploy.zip
 *
 * 关键点：压缩包内 index.html 必须位于【根层】。因此这里先把 site/ 的内容
 * 复制进一个空的暂存目录，再按暂存目录的【内容】（tmp/*）打包，
 * 避免出现 site/ 或 wiki/ 这类多余的外层目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'netlify-deploy.zip');
const STAGE = path.join(ROOT, '.pack-stage');

console.log('[1/3] 构建站点...');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  process.stdout.write(out);
} catch (err) {
  console.error('[!] 构建失败：');
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  process.exit(1);
}

if (!fs.existsSync(SITE) || !fs.existsSync(path.join(SITE, 'index.html'))) {
  console.error('[!] 未找到 site/index.html —— 构建可能失败，已中止。');
  process.exit(1);
}

console.log('[2/3] 准备暂存目录...');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const name of fs.readdirSync(SITE)) {
  fs.cpSync(path.join(SITE, name), path.join(STAGE, name), { recursive: true });
}

const staged = fs.readdirSync(STAGE);
if (!staged.includes('index.html')) {
  console.error('[!] 暂存目录里没有 index.html，压缩包结构会不对，已中止。');
  fs.rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
}
console.log(`      暂存 ${staged.length} 个条目`);

console.log('[3/3] 打包...');
fs.rmSync(OUT, { force: true });
try {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${OUT}' -CompressionLevel Optimal`,
    ],
    { stdio: 'inherit' }
  );
} catch (err) {
  console.error('[!] 打包失败（Compress-Archive 不可用？）。');
  fs.rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
}
fs.rmSync(STAGE, { recursive: true, force: true });

const size = fs.statSync(OUT).size;
console.log('');
console.log(`✓ 已生成：${OUT}`);
console.log(`  大小：${(size / 1024).toFixed(1)} KB`);
console.log('');
console.log('用法：登录 Netlify → Add new site → Deploy manually → 把这个 zip 拖进去。');
console.log('      压缩包根层已是 index.html，无需解压。');
