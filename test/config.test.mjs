import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeConfig, resolveConfig, writeSharedConfig, configPath,
} from '../lib/config.js';

function withHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpvcfg-'));
  const prev = process.env.JP_VOCAB_HOME;
  process.env.JP_VOCAB_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.JP_VOCAB_HOME;
    else process.env.JP_VOCAB_HOME = prev;
  }
}

test('归一化：日界夹取到 0-6，枚举兜底，布尔缺省为真', () => {
  const a = normalizeConfig({ dayStartHour: 99, enrichMode: '乱写' });
  assert.equal(a.dayStartHour, 6);
  assert.equal(a.enrichMode, 'auto');
  assert.equal(a.overwrite, true);
  assert.equal(a.groupByPos, true);

  const b = normalizeConfig({ dayStartHour: -1, enrichMode: 'manual', overwrite: false, groupByPos: false });
  assert.equal(b.dayStartHour, 0);
  assert.equal(b.enrichMode, 'manual');
  assert.equal(b.overwrite, false);
  assert.equal(b.groupByPos, false);
});

test('归一化：日界是小数/字符串时按整数处理', () => {
  assert.equal(normalizeConfig({ dayStartHour: '3.9' }).dayStartHour, 3);
  assert.equal(normalizeConfig({ dayStartHour: 'abc' }).dayStartHour, 0);
});

test('resolveConfig：共享文件优先于 patch 配置', () => {
  withHome((dir) => {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      `\uFEFF${JSON.stringify({ dayStartHour: 6, summariesDir: 'F:\\from-file' })}`,
      'utf8',
    );
    const cfg = resolveConfig({ dayStartHour: 2, summariesDir: 'F:\\from-patch' });
    assert.equal(cfg.dayStartHour, 6, '文件里的值应该赢');
    assert.equal(cfg.summariesDir, 'F:\\from-file');
    assert.equal(configPath(), path.join(dir, 'config.json'));
  });
});

test('resolveConfig：文件缺失时回落 patch → 默认', () => {
  withHome(() => {
    const cfg = resolveConfig({ dayStartHour: 4 });
    assert.equal(cfg.dayStartHour, 4);
    assert.equal(cfg.enrichMode, 'auto');
  });
});

test('writeSharedConfig：只改传入字段，其余保留', () => {
  withHome((dir) => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ dayStartHour: 3, overwrite: false }), 'utf8');
    const next = writeSharedConfig({ enrichMode: 'manual' });
    assert.equal(next.dayStartHour, 3, '未传的字段不能被重置');
    assert.equal(next.overwrite, false);
    assert.equal(next.enrichMode, 'manual');

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(saved.enrichMode, 'manual');
    assert.equal(saved.dayStartHour, 3);
  });
});
