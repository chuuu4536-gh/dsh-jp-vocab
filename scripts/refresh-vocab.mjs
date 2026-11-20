#!/usr/bin/env node
/**
 * 重抓指定日期的词汇数据（用当前解析器覆盖旧解析结果）。
 *
 * 用法：node scripts/refresh-vocab.mjs 2026-11-19 [--dir vocab]
 *
 * - 先写 <文件>.bak 备份；
 * - 保留用户侧字段（word/surface/context/pageUrl/pageTitle/capturedAt/count/lemmaSource/candidates）；
 * - 只覆盖词典侧字段（reading/pitch/pos/senses/gloss/examples/url）；
 * - 单条失败保留原记录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEntry, buildUrl } from '../edge-ext/parse.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 Edg/131';

/** 把重新解析出的词条合并回原记录：用户字段不动，词典字段覆盖。 */
export function mergeRefreshed(record, entry) {
  if (!entry || !entry.word) return record;
  return {
    ...record,
    reading: entry.reading ?? record.reading,
    romaji: entry.romaji ?? record.romaji,
    pitch: entry.pitch ?? record.pitch,
    pitchNumber: entry.pitchNumber ?? record.pitchNumber,
    pos: Array.isArray(entry.pos) && entry.pos.length ? entry.pos : record.pos,
    senses: Array.isArray(entry.senses) && entry.senses.length ? entry.senses : record.senses,
    gloss: entry.gloss || record.gloss,
    examples: Array.isArray(entry.examples) ? entry.examples : record.examples,
    url: entry.url || record.url,
    refreshedAt: new Date().toISOString(),
  };
}

async function fetchEntry(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(buildUrl(word), {
      signal: controller.signal,
      headers: { 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEntry(await res.text(), { word, url: buildUrl(word) });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [date, ...rest] = process.argv.slice(2);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('用法：node scripts/refresh-vocab.mjs YYYY-MM-DD [--dir vocab]');
    process.exit(1);
  }
  const dirIndex = rest.indexOf('--dir');
  const vocabDir = dirIndex >= 0 ? rest[dirIndex + 1] : 'vocab';
  const file = path.join(vocabDir, `${date}.jsonl`);
  if (!fs.existsSync(file)) {
    console.error(`找不到 ${file}`);
    process.exit(1);
  }

  fs.copyFileSync(file, `${file}.bak`);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = [];
  let ok = 0;
  let failed = 0;

  for (const [i, record] of rows.entries()) {
    const word = String(record.word || '').trim();
    let next = record;
    if (word) {
      try {
        const entry = await fetchEntry(word);
        if (entry) {
          next = mergeRefreshed(record, entry);
          ok += 1;
        } else {
          failed += 1;
          console.warn(`  [${i + 1}/${rows.length}] ${word} 词典无结果，保留原记录`);
        }
      } catch (error) {
        failed += 1;
        console.warn(`  [${i + 1}/${rows.length}] ${word} 重抓失败（${error.message}），保留原记录`);
      }
      await sleep(300);
    }
    out.push(next);
  }

  fs.writeFileSync(file, `${out.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(`已更新 ${file}：成功 ${ok}，失败 ${failed}（备份 ${file}.bak）`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
