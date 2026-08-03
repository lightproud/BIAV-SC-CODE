// Black Pool silent native launcher (build/ production piece, zero intranet values).
// Compiled at assembly time by the stock .NET Framework csc (present on every
// Windows runner/machine) into "Black Pool.exe" at the bundle root:
//   /target:winexe  -> windowed subsystem, no console box ever flashes
//   /win32icon      -> embedded brand icon
// It runs launcher.cmd hidden (BPA_SILENT suppresses its pauses); on failure it
// shows a message box and opens launcher.log. Success path is fully silent.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class BlackPoolLauncher
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string cmd = Path.Combine(root, "launcher.cmd");
        if (!File.Exists(cmd))
        {
            MessageBox.Show("launcher.cmd 缺失，请完整复制整个 BlackPool 目录。",
                            "Black Pool", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        string extra = args.Length > 0 ? " " + string.Join(" ", args) : "";
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        psi.Arguments = "/d /c call \"" + cmd + "\"" + extra;
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.EnvironmentVariables["SC_LAUNCHER_KEEPWIN"] = "1"; // skip cmd /k re-wrap
        psi.EnvironmentVariables["BPA_SILENT"] = "1";          // suppress pauses

        Process p = Process.Start(psi);
        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            string log = Path.Combine(root, "launcher.log");
            MessageBox.Show("Black Pool 启动失败（退出码 " + p.ExitCode + "），即将打开诊断日志。",
                            "Black Pool", MessageBoxButtons.OK, MessageBoxIcon.Error);
            if (File.Exists(log))
            {
                Process.Start("notepad.exe", "\"" + log + "\"");
            }
            return p.ExitCode;
        }
        return 0;
    }
}
