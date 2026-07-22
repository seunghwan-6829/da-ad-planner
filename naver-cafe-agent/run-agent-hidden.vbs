' 발행 에이전트를 창 없이 실행한다(윈도우 시작 시 자동 실행용).
' 검은 콘솔 창이 계속 떠 있으면 거슬리고 실수로 닫기도 쉬워서, 백그라운드로 돌린다.
' 로그는 naver-cafe-agent\agent.log 에 쌓인다.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' 0 = 창 숨김, False = 끝날 때까지 기다리지 않음
sh.Run "cmd /c node agent.mjs >> agent.log 2>&1", 0, False
