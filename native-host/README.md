# 本地宿主注册说明（Native Messaging）

扩展要把星标词汇写进 `vocab/YYYY-MM-DD.jsonl`，但浏览器不能直接写盘，
中间必须有一个「本地宿主」进程。这个目录就是那个宿主。

```
Edge 扩展  --stdin/stdout 协议帧-->  host.exe  --读取-->  node.exe + host.js  -->  vocab/*.jsonl
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `host.exe` | 真正的入口。Chrome/Edge 用 CreateProcess 拉起宿主，**.bat 不能当可执行文件**，所以要有 exe |
| `launcher.cs` | host.exe 的源码（转发 stdin/stdout，把子进程 stderr 写日志） |
| `node-path.txt` | node.exe 的绝对路径（换机器/换 DSH 版本时只改这个） |
| `script-path.txt` | host.js 的绝对路径（移动目录后改这个） |
| `host.js` | 协议实现：4 字节小端长度 + UTF-8 JSON |
| `lib/core.cjs` | 落盘逻辑（按天分文件、同词去重、跨零点、路径越界防护） |
| `manifest.json` | Native Messaging 宿主清单，`path` 指向 host.exe |
| `install.ps1` | 写注册表（Edge + Chrome 各一份） |
| `verify.ps1` | 自检：清单 / 文件 / 注册表 / 协议 ping |

## 三步

### 1. 注册

在 PowerShell 里（不是 CMD）：

```powershell
cd D:\DSH\Plugin\jp-vocab\native-host
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

脚本会：检查 manifest 指向的 exe 是否存在 → 检查 node 路径 → 尝试创建
`%USERPROFILE%\.jp-vocab\config.json` → 写两条注册表 → 自动跑 verify。

### 2. 重启浏览器

Edge 会缓存 Native Messaging 宿主清单。**完全退出 Edge**（含托盘图标）再打开，
或至少到 `edge://extensions` 点一次刷新。

### 3. 验证

最直观的验证在扩展设置页：`edge://extensions` → 日语查词 → 详情 → 扩展选项 →
顶部应显示「本地宿主已连接（v0.1.0，pid xxxx）」。点「测试本地宿主」可复测。

命令行验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File verify.ps1
```

四项全绿 = 链路通。若只差注册表两项，说明第 1 步没执行成功。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```
只删注册表，不动你的词汇文件。

## 常见报错

| 现象 | 原因 | 处理 |
|---|---|---|
| `Specified native messaging host not found` | 注册表没写 / 名字不一致 | 重跑 install.ps1；核对 `manifest.name` 与 `background.js` 里的 `HOST_NAME` 都是 `asia.dict.japanese.lookup` |
| `Access to the specified native messaging host is forbidden` | `allowed_origins` 里的扩展 ID 与实际不符 | `edge://extensions` 看 ID，必须等于 `neblnajeachbgmnfibhjpmmlbelgfdjh`（由 manifest 的 `key` 决定） |
| `Native host has exited` | 宿主崩了 | 看 `native-host\.data\host.log` 或 `%USERPROFILE%\.jp-vocab\host.log` |
| 点星没反应，但设置页显示已连接 | 落盘目录不可写 | 检查 `config.json` 的 `vocabDir`，确认对当前用户可写 |
| Edge 重启后仍报 not found | 注册表写在 32 位视图 / 没退出干净 | 确认键在 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts`，并彻底退出 Edge |
| 杀毒软件拦截 host.exe | 未签名 exe | 允许一次即可；或对目录加白名单 |

## 移动目录后

`manifest.json` 的 `path`、`node-path.txt`、`script-path.txt` 都是绝对路径。
移动后改这三处，再重跑 `install.ps1`。

## 为什么不用 .bat

实测：`Process.Start("host.bat")` 直接抛 `EINVAL`。Windows 的 CreateProcess 需要可执行映像，
批处理必须经 `cmd.exe /c` 才能跑，而 Native Messaging 清单不支持传参数。
所以编译了一个 6.6 KB 的 C# 启动器（`launcher.cs` → `host.exe`）。
