; Electron registers nextbrowser:// when the packaged app starts. Remove only
; a handler owned by this installation during an actual uninstall.
!macro nextbrowserRemoveOwnedProtocol HIVE
  ReadRegStr $0 ${HIVE} "Software\Classes\nextbrowser\shell\open\command" ""
  StrLen $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  StrCpy $2 $0 $1
  ${If} $2 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    DeleteRegKey ${HIVE} "Software\Classes\nextbrowser"
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    !insertmacro nextbrowserRemoveOwnedProtocol HKCU
    !insertmacro nextbrowserRemoveOwnedProtocol SHELL_CONTEXT
    Pop $2
    Pop $1
    Pop $0
    ClearErrors
  ${EndIf}
!macroend
