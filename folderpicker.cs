using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class FolderPicker {
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int dwProcessId);

    [STAThread]
    static void Main(string[] args) {
        if (args.Length < 1) return;
        string resultFile = args[0];
        string initialPath = args.Length >= 2 ? args[1] : null;
        try {
            Application.EnableVisualStyles();

            // 用 TopMost 隐藏窗口抢焦点，确保对话框置顶
            var owner = new Form();
            owner.TopMost = true;
            owner.ShowInTaskbar = false;
            owner.WindowState = FormWindowState.Minimized;
            owner.Load += (s, e) => {
                owner.Visible = false;
            };
            owner.Show();
            SetForegroundWindow(owner.Handle);
            AllowSetForegroundWindow(System.Diagnostics.Process.GetCurrentProcess().Id);

            using (var dlg = new FolderBrowserDialog()) {
                dlg.Description = "选择战报截图文件夹";
                dlg.ShowNewFolderButton = true;
                // 设置初始路径（如果提供且存在）
                if (!string.IsNullOrEmpty(initialPath) && Directory.Exists(initialPath)) {
                    dlg.SelectedPath = initialPath;
                }
                DialogResult result = dlg.ShowDialog(owner);
                owner.Close();
                if (result == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath)) {
                    File.WriteAllText(resultFile, dlg.SelectedPath, System.Text.Encoding.UTF8);
                } else {
                    File.WriteAllText(resultFile, "CANCELLED", System.Text.Encoding.UTF8);
                }
            }
        } catch (Exception ex) {
            File.WriteAllText(resultFile, "ERROR:" + ex.Message, System.Text.Encoding.UTF8);
        }
    }
}
