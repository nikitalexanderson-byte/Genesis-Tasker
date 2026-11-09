param([string[]]$Serial=@(), [string]$RunId=('android-notifications-'+(Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'android-common.ps1')
$nativeSourceHash=Get-NativeSourceHash $root
$runnerSourceHash=Get-NativeRunnerHash $root
$identity=Assert-NativeBuildIdentity $root $nativeSourceHash
$output=Join-Path $root "output/qa/$RunId"
New-Item -ItemType Directory -Path $output -Force | Out-Null
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
$adb=Join-Path $sdk 'platform-tools/adb.exe'
$package='ru.genesis.calendar.qa1103.debug'
$results=[System.Collections.Generic.List[object]]::new()
$reasons=[System.Collections.Generic.List[string]]::new()
$devices=[System.Collections.Generic.List[object]]::new()
function Adb([string[]]$Arguments) {
    $text=(& $adb @Arguments 2>&1)-join "`n"
    if($LASTEXITCODE -ne 0){throw "ADB failed for the isolated notification probe: $($Arguments[2])"}
    return $text
}
function Save-Report {
    [ordered]@{runId=$RunId;sourceCommit=(& git -C $root rev-parse HEAD);sourceHash=$nativeSourceHash;
        nativeSourceHash=$nativeSourceHash;runnerSourceHash=$runnerSourceHash;build=$identity;package=$package;
        devices=@($devices);results=@($results);reasons=@($reasons);
        status=if($reasons.Count -or @($results | Where-Object {$_.status -notin @('PASS','NOT_APPLICABLE')}).Count -or !$results.Count){'INCOMPLETE'}else{'PASS_SELECTED_NATIVE_SCOPE'};
        limitations=@('System boot, long Doze, battery restriction, and OEM sleep-list changes are not simulated.','Only task-owned package permissions and data are changed.','Physical Samsung screen remains awake; emulator alarm delivery also runs with its screen off.')} |
        ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $output 'results.json') -Encoding utf8
}
function Run-Step([string]$Device,[string]$Label,[string]$Class,[string]$Method) {
    $text=(& $adb -s $Device shell am instrument --user 0 -w -r -e class "ru.genesis.calendar.$Class#$Method" "$package.test/androidx.test.runner.AndroidJUnitRunner" 2>&1)-join "`n"
    $result=Convert-NativeInstrumentation $text $LASTEXITCODE
    $relative="output/qa/$RunId/$Label/$Class-$Method.log"
    $text | Set-Content -LiteralPath (Join-Path $root $relative) -Encoding utf8
    $result.device=$Label;$result.class="ru.genesis.calendar.$Class";$result.log=$relative
    $results.Add($result);Save-Report
    Write-Host "$Label $Class#$Method $($result.status)"
    return $result.status -eq 'PASS'
}
function Stop-BackgroundQaProcess([string]$Device,[string]$Label,[string]$Name) {
    Adb @('-s',$Device,'shell','input','keyevent','KEYCODE_HOME') | Out-Null
    $before=((& $adb -s $Device shell pidof $package)-join '').Trim()
    # am kill can preserve a recently foreground process. Kill only PIDs returned
    # for this isolated debuggable package, under its own UID; do not force-stop
    # the package, since that would cancel the pending AlarmManager scenario.
    if($before){
        foreach($processId in ($before -split '\s+')){
            if($processId -notmatch '^\d+$'){throw 'Unexpected isolated package PID'}
            Adb @('-s',$Device,'shell','run-as',$package,'kill','-9',$processId) | Out-Null
        }
    }
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(5)
    do {
        $after=((& $adb -s $Device shell pidof $package)-join '').Trim()
        if($after){Start-Sleep -Milliseconds 200}
    } until(!$after -or [DateTimeOffset]::UtcNow -gt $deadline)
    $result=[ordered]@{device=$Label;class='runner.processDeath';method=$Name;status=if($after){'FAIL'}else{'PASS'};
        processBefore=$before;processAfter=$after;alreadyAbsent=(!$before);operation='run-as isolated debug package kill -9 observed PIDs; no force-stop';at=[DateTimeOffset]::UtcNow.ToString('o')}
    $results.Add($result);Save-Report
    if($after){throw 'The QA process did not exit before alarm delivery'}
}
try {
    if(!$Serial.Count){$Serial=@((& $adb devices)|Where-Object{$_ -match '^\S+\s+device\s*$'}|ForEach-Object{($_ -split '\s+')[0]})}
    if(!$Serial.Count){throw 'BLOCKED: no Android device'}
    foreach($serial in $Serial){
        $label=if($serial.StartsWith('emulator-')){$serial}else{'samsung-physical'}
        New-Item -ItemType Directory -Path (Join-Path $output $label) -Force | Out-Null
        $api=[int](Adb @('-s',$serial,'shell','getprop','ro.build.version.sdk')).Trim()
        $devices.Add([ordered]@{id=$label;api=$api;screenOffAlarm=$serial.StartsWith('emulator-')})
        foreach($artifact in $identity.artifacts){if($artifact.path.EndsWith('.apk')){Adb @('-s',$serial,'install','-r',(Join-Path $root $artifact.path)) | Out-Null}}
        Adb @('-s',$serial,'shell','pm','clear','--user','0',$package) | Out-Null
        Adb @('-s',$serial,'shell','input','keyevent','KEYCODE_WAKEUP') | Out-Null
        if($api -ge 33){Adb @('-s',$serial,'shell','pm','grant','--user','0',$package,'android.permission.POST_NOTIFICATIONS') | Out-Null}
        try {
            foreach($method in @('distinctTaskAndHabitChannelsAndNotifications','migratingChannelsPreservesDisabledAndVibrationSettings','batterySettingsIntentsAreScopedAndSamsungAware')) {
                Run-Step $serial $label 'NotificationReliabilityTest' $method | Out-Host
            }
            foreach($method in @('fiveRemindersPersistAndCancelTogether','snoozeAndStaleVersionAreIdempotent','notificationOpensTheStoredRecord')) {
                Run-Step $serial $label 'ReminderFlowTest' $method | Out-Host
            }
            Run-Step $serial $label 'NotificationRouteTest' 'habitNotificationUsesPlainCopyAndOpensHabits' | Out-Host
            if(Run-Step $serial $label 'NotificationReliabilityTest' 'armDiagnosticAlarm') {
                $fixture=Adb @('-s',$serial,'shell','run-as',$package,'cat','shared_prefs/genesis.notification.reliability.test.xml')
                [xml]$xml=$fixture
                $scheduled=[long](@($xml.map.long)|Where-Object name -eq 'scheduledAt').value
                if($scheduled -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+1000){throw 'Alarm was already due before the process-death probe'}
                Stop-BackgroundQaProcess $serial $label 'beforeDiagnosticAlarm'
                $remaining=$scheduled-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+6000
                if($remaining -gt 0){Start-Sleep -Milliseconds $remaining}
                Run-Step $serial $label 'NotificationReliabilityTest' 'verifyDiagnosticAfterProcessDeath' | Out-Host
            }
            if(Run-Step $serial $label 'ReminderFlowTest' 'prepareScreenOffReminder') {
                Stop-BackgroundQaProcess $serial $label 'beforeTaskAlarm'
                if($serial.StartsWith('emulator-')){Adb @('-s',$serial,'shell','input','keyevent','KEYCODE_SLEEP') | Out-Null}
                # A real AlarmManager delay, not a direct call to deliver().
                $until=[DateTimeOffset]::UtcNow.AddSeconds(96)
                while([DateTimeOffset]::UtcNow -lt $until){Start-Sleep -Seconds 1}
                Adb @('-s',$serial,'shell','input','keyevent','KEYCODE_WAKEUP') | Out-Null
                if(Run-Step $serial $label 'ReminderFlowTest' 'verifyDeliveredAndCompleteAction') {
                    Stop-BackgroundQaProcess $serial $label 'afterNotificationCompletion'
                    Run-Step $serial $label 'ReminderFlowTest' 'persistedCompletionSurvivesFreshProcess' | Out-Host
                }
            }
            if($api -ge 33){
                if(Run-Step $serial $label 'FullQaNotificationPermissionTest' 'prepareGrantedPermissionAndPersistentReminder') {
                    Adb @('-s',$serial,'shell','pm','revoke','--user','0',$package,'android.permission.POST_NOTIFICATIONS') | Out-Null
                    Run-Step $serial $label 'FullQaNotificationPermissionTest' 'deniedPermissionSuppressesNotificationsWithoutDeletingData' | Out-Host
                    Adb @('-s',$serial,'shell','pm','grant','--user','0',$package,'android.permission.POST_NOTIFICATIONS') | Out-Null
                    Run-Step $serial $label 'FullQaNotificationPermissionTest' 'restoredPermissionKeepsTheSameEncryptedReminder' | Out-Host
                }
            }else{
                $results.Add([ordered]@{device=$label;class='FullQaNotificationPermissionTest';status='NOT_APPLICABLE';reason='POST_NOTIFICATIONS runtime permission was introduced in API33; channel disable preservation is tested independently.'})
            }
        } finally {
            if($api -ge 33){& $adb -s $serial shell pm grant --user 0 $package android.permission.POST_NOTIFICATIONS 2>$null | Out-Null}
            & $adb -s $serial shell input keyevent KEYCODE_WAKEUP | Out-Null
            & $adb -s $serial pull "/sdcard/Android/data/$package/files" (Join-Path $output "$label/artifacts") 2>&1 | Out-Null
        }
    }
} catch {$reasons.Add($_.Exception.Message);Write-Error -ErrorAction Continue $_}
finally {Save-Report}
if($reasons.Count -or @($results | Where-Object {$_.status -notin @('PASS','NOT_APPLICABLE')}).Count -or !$results.Count){exit 1}
exit 0
