// Native Messaging 启动器：把 node.exe + host.js 包成一个可执行入口。
//
// 为什么需要它：Chrome/Edge 用 CreateProcess 拉起宿主，.bat 不能直接作为
// 可执行映像（会失败），所以必须提供一个真正的 .exe。
//
// 编译：csc /nologo /target:exe /out:host.exe launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

static class Launcher
{
    static string ReadOr(string file, string fallback)
    {
        try
        {
            if (File.Exists(file))
            {
                var text = File.ReadAllText(file).Trim();
                if (text.Length > 0) return text;
            }
        }
        catch { }
        return fallback;
    }

    static int Main()
    {
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var node = ReadOr(Path.Combine(baseDir, "node-path.txt"), @"NODE_PATH_PLACEHOLDER");
        var script = ReadOr(Path.Combine(baseDir, "script-path.txt"), @"SCRIPT_PATH_PLACEHOLDER");
        var log = Path.Combine(baseDir, "launcher.log");
        try { File.AppendAllText(log, DateTime.Now.ToString("s") + " START pid=" + Process.GetCurrentProcess().Id + Environment.NewLine); } catch { }

        try
        {
            var psi = new ProcessStartInfo(node, "\"" + script + "\"")
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            var child = Process.Start(psi);
            try { File.AppendAllText(log, DateTime.Now.ToString("s") + " CHILD pid=" + child.Id + Environment.NewLine); } catch { }

            child.ErrorDataReceived += (s, e) =>
            {
                if (e.Data == null) return;
                try { File.AppendAllText(log, DateTime.Now.ToString("s") + " " + e.Data + Environment.NewLine); } catch { }
            };
            child.BeginErrorReadLine();

            // stdin（浏览器）→ 子进程
            var pump = new Thread(() =>
            {
                try
                {
                    using (var stdin = Console.OpenStandardInput())
                    {
                        var buf = new byte[8192];
                        int n;
                        long total = 0;
                        while ((n = stdin.Read(buf, 0, buf.Length)) > 0)
                        {
                            child.StandardInput.BaseStream.Write(buf, 0, n);
                            child.StandardInput.BaseStream.Flush();
                            total += n;
                        }
                        try { File.AppendAllText(log, DateTime.Now.ToString("s") + " STDIN total=" + total + Environment.NewLine); } catch { }
                    }
                }
                catch { }
                try { child.StandardInput.Close(); } catch { }
            });
            pump.IsBackground = true;
            pump.Start();

            // 子进程 stdout → stdout（协议帧原样透传）
            using (var stdout = Console.OpenStandardOutput())
            {
                var buf = new byte[8192];
                int n;
                while ((n = child.StandardOutput.BaseStream.Read(buf, 0, buf.Length)) > 0)
                {
                    stdout.Write(buf, 0, n);
                    stdout.Flush();
                }
            }

            child.WaitForExit();
            try { File.AppendAllText(log, DateTime.Now.ToString("s") + " EXIT code=" + child.ExitCode + Environment.NewLine); } catch { }
            return child.ExitCode;
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(log, DateTime.Now.ToString("s") + " FATAL " + ex + Environment.NewLine); } catch { }
            return 1;
        }
    }
}
