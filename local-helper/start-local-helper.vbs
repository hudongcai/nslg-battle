Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\helper-ui.ps1"
logPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\helper-launch.log"
launchArg = ""
If WScript.Arguments.Count > 0 Then
  launchArg = " -LaunchArg """ & Replace(WScript.Arguments(0), """", """""") & """"
End If
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File """ & scriptPath & """" & launchArg & " *> """ & logPath & """"
shell.Run cmd, 0, False

' 显示启动提示
MsgBox "真武本地助手已启动" & vbCrLf & vbCrLf & "助手已在后台运行，图标已隐藏在系统托盘。" & vbCrLf & vbCrLf & "右键点击托盘图标可以查看菜单。", vbInformation + vbSystemModal, "真武本地助手"


