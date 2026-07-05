' 창 없이(hidden) download-daily.bat 을 실행하는 런처. Windows 작업 스케줄러가 이 vbs 를 호출.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\download-daily.bat""", 0, False
