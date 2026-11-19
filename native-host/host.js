#!/usr/bin/env node
/**
 * Native Messaging 宿主入口：只做「4 字节小端长度 + UTF-8 JSON」的收发。
 * 业务逻辑在 lib/core.cjs（可在沙箱内单测）。
 *
 * 注意：stdout 只能出现协议帧，任何 console.log 都会让扩展读到脏数据，
 * 日志一律追加到 <home>/host.log。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { homeDir, dispatch } = require('./lib/core.cjs');

/** 家目录不可写时（沙箱/受限环境）退到脚本同级的 .data，保证仍能工作。 */
let ROOT = homeDir();
try {
  fs.mkdirSync(ROOT, { recursive: true });
} catch {
  ROOT = path.join(__dirname, '.data');
  try { fs.mkdirSync(ROOT, { recursive: true }); } catch { /* 实在不行就只读运行 */ }
}
const LOG_PATH = path.join(ROOT, 'host.log');

function log(...args) {
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch { /* 日志失败不阻塞主流程 */ }
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

let buffer = Buffer.alloc(0);
/** 去掉可能出现的 UTF-8 BOM（某些启动器会在第一次写入时带 BOM，直接解析会算出天文长度）。 */
function trimBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3);
  return buf;
}
process.stdin.on('data', (chunk) => {
  buffer = trimBom(Buffer.concat([buffer, chunk]));
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    let reply;
    try {
      reply = dispatch(JSON.parse(body), ROOT);
    } catch (error) {
      log('dispatch 失败', String(error && error.message));
      reply = { ok: false, error: String((error && error.message) || error) };
    }
    writeMessage(reply);
  }
});

// stdin 关闭后不要立刻 exit：stdout 是管道时写入是异步的，直接退出会把
// 还没刷出去的响应帧截断（浏览器侧表现为「点了星却没反应」）。
process.stdin.on('end', () => {
  process.stdin.pause();
  process.stdout.write('', () => process.exit(0));
});
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
});
process.on('uncaughtException', (error) => log('uncaught', String(error && error.stack)));
log('host 启动', process.pid, ROOT);
