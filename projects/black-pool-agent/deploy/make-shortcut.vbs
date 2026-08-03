' Black Pool shortcut maker (stock WSH, no PowerShell).
' Usage: cscript //nologo make-shortcut.vbs <lnk-path> <target> <workdir> <icon>
Set sh = CreateObject("WScript.Shell")
Set lnk = sh.CreateShortcut(WScript.Arguments(0))
lnk.TargetPath = WScript.Arguments(1)
lnk.WorkingDirectory = WScript.Arguments(2)
lnk.IconLocation = WScript.Arguments(3)
lnk.Description = "Black Pool"
lnk.Save
