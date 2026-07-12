Set shell = CreateObject("WScript.Shell")
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\helper-ui.ps1"
logPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\helper-launch.log"
launchArg = ""
If WScript.Arguments.Count > 0 Then
  launchArg = " -LaunchArg """ & Replace(WScript.Arguments(0), """", """""") & """"
End If
cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File """ & scriptPath & """" & launchArg & " *> """ & logPath & """"
shell.Run cmd, 0, False
