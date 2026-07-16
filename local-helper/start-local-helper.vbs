Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\helper-ui.ps1"
launchArg = ""
If WScript.Arguments.Count > 0 Then
  launchArg = " -LaunchArg """ & Replace(WScript.Arguments(0), """", """""") & """"
End If
cmd = "powershell.exe -NoProfile -STA -WindowStyle Normal -ExecutionPolicy Bypass -File """ & scriptPath & """" & launchArg
shell.Run cmd, 0, False


