' WorldForge - fully windowless launcher (double-click me)
' Same as the .bat but with zero cmd flash.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(exe) Then
  sh.Run """" & exe & """ """ & here & """", 0, False
Else
  MsgBox "Electron isn't installed in this folder yet." & vbCrLf & _
         "One-time fix: open a terminal in this folder and run:  npm install", _
         48, "WorldForge"
End If
