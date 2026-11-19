/**
 * 版本一致性：四处版本号（package / 扩展清单 / 构建号 / 宿主 ping）
 * 加上 CHANGELOG 必须同步，避免出现 0.2.0 与 0.6.0 同时存在的情况。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PKG_VERSION = JSON.parse(read('package.json')).version;

function parseVersion(v) {
  return v.split('.').map(Number);
}

test('package.json / manifest / BUILD / 宿主 ping 版本一致', () => {
  const manifest = JSON.parse(read('edge-ext/manifest.json')).version;
  const build = (read('edge-ext/content.js').match(/const BUILD = '([^']+)'/) ?? [])[1];
  const host = (read('native-host/lib/core.cjs').match(/version: '([^']+)'/) ?? [])[1];

  assert.equal(manifest, PKG_VERSION, '扩展 manifest 版本与 package.json 不一致');
  assert.equal(build, PKG_VERSION, 'content.js 的 BUILD 与 package.json 不一致');
  assert.equal(host, PKG_VERSION, '宿主 ping 版本与 package.json 不一致');
});

test('CHANGELOG 里有当前版本的小节', () => {
  const log = read('CHANGELOG.md');
  const escaped = PKG_VERSION.replace(/\./g, '\\.');
  assert.match(log, new RegExp(`^## \\[${escaped}\\]`, 'm'));
});

test('CHANGELOG 结构：Unreleased 在最前，版本号降序且不重复', () => {
  const log = read('CHANGELOG.md');
  const unreleased = log.indexOf('## [Unreleased]');
  const firstVersion = log.search(/^## \[\d+\.\d+\.\d+\]/m);
  assert.ok(unreleased >= 0 && unreleased < firstVersion, 'Unreleased 应在所有版本小节之前');

  const versions = [...log.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  assert.ok(versions.length >= 2, '版本小节太少');

  const seen = new Set();
  for (const v of versions) {
    assert.equal(seen.has(v), false, `版本 ${v} 重复`);
    seen.add(v);
  }

  for (let i = 1; i < versions.length; i += 1) {
    const [a, b] = [parseVersion(versions[i - 1]), parseVersion(versions[i])];
    const ok = b[0] < a[0]
      || (b[0] === a[0] && b[1] < a[1])
      || (b[0] === a[0] && b[1] === a[1] && b[2] < a[2]);
    assert.ok(ok, `版本顺序错误：${versions[i - 1]} 之后不应是 ${versions[i]}`);
  }
});
