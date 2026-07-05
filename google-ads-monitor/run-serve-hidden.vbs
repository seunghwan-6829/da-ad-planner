' 창 없이(hidden) 로컬 영상 서버(serve-videos.mjs)를 실행하는 런처. 로그온 시 작업 스케줄러가 호출.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node """ & dir & "\serve-videos.mjs""", 0, False
