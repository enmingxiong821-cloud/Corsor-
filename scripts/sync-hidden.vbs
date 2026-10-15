' Silent launcher for `node src/cli.mjs sync`.
' WSH parses .vbs using the system ANSI code page, so keep this file ASCII-only.
' Invoked by the "CursorZhAutoSync" scheduled task: no console window, no waiting.
Option Explicit

Dim shell, fso, scriptDir, root, cmd

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' this file lives in <root>\scripts\ ; the project root is one level up
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = root

If Not fso.FolderExists(root & "\logs") Then fso.CreateFolder(root & "\logs")

' 0 = hidden window, False = do not wait for completion.
' stderr goes to logs\sync.out so a crash (e.g. bad syntax) still leaves a trace.
cmd = "cmd.exe /c node.exe """ & root & "\src\cli.mjs"" sync >> """ & root & "\logs\sync.out"" 2>&1"
shell.Run cmd, 0, False
