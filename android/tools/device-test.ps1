param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('prepare','open','complete','persist','snooze','ui','diagnostics','preferences')]
    [string]$Stage,
    [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
)
$ErrorActionPreference='Stop'
$adb=Join-Path $SdkRoot 'platform-tools\adb.exe'
$cases=@{
    prepare='ReminderFlowTest#prepareScreenOffReminder'
    open='ReminderFlowTest#notificationOpensTheStoredRecord'
    complete='ReminderFlowTest#verifyDeliveredAndCompleteAction'
    persist='ReminderFlowTest#persistedCompletionSurvivesFreshProcess'
    snooze='ReminderFlowTest#snoozeAndStaleVersionAreIdempotent'
    ui='NativeUiTest'
    diagnostics='ReminderFlowTest#notificationChannelDiagnostics'
    preferences='PreferencesTest'
}
$devices=@(& $adb devices | Select-String '^\S+\s+device$')
if($devices.Count -ne 1) { throw 'Exactly one approved adb device must be connected; do not guess the target.' }
$target='ru.genesis.calendar.debug.test/androidx.test.runner.AndroidJUnitRunner'
$result=& $adb shell am instrument -w -e class "ru.genesis.calendar.$($cases[$Stage])" $target 2>&1
$reportDirectory=Join-Path $PSScriptRoot '..\app\build\reports\device'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$result | Tee-Object -FilePath (Join-Path $reportDirectory "$Stage.txt")
# am instrument often returns exit=0 even when JUnit fails.
if($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'OK \(\d+ tests?\)' -or ($result -join "`n") -match 'FAILURES!!!|INSTRUMENTATION_FAILED') {
    throw "Device stage '$Stage' did not pass. See its report; no subsequent stage was run."
}
