param(
    [string[]]$Avds = @(),
    [int]$Port = 5580,
    [string[]]$TestClasses = @(),
    [switch]$SkipReminders,
    [switch]$SkipAccessibility,
    [string]$ReportName = 'full-emulator-matrix-2.4.5'
)
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$emulator = Join-Path $sdk 'emulator/emulator.exe'
$serial = "emulator-$Port"
$package = 'ru.genesis.calendar.debug'
$runner = "$package.test/androidx.test.runner.AndroidJUnitRunner"
$androidRoot = (Resolve-Path "$PSScriptRoot/..").Path
$report = Join-Path $androidRoot "build/reports/$ReportName"
New-Item -ItemType Directory -Force -Path $report | Out-Null
$apk = Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk'
$testApk = Join-Path $androidRoot 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
if (!$Avds.Count) { $Avds = @(& $emulator -list-avds) }
$classes = Get-ChildItem "$androidRoot/app/src/androidTest/java/ru/genesis/calendar" -Filter '*Test.kt' |
    Where-Object { $_.BaseName -notin @('NotificationReliabilityTest','TalkBackAccessibilityTest','BackgroundReminderTest','ReminderFlowTest') } |
    Sort-Object @{Expression={if ($_.BaseName -in @('LanguageGridTest','CalendarModeHeaderTest','ResponsiveWorkspaceTest')) {0} else {1}}}, Name |
    Select-Object -ExpandProperty BaseName
if ($TestClasses.Count) { $classes = $TestClasses }
function Adb {
    $result = & $adb -s $serial @args 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $result }
    return $result.Trim()
}
function Instrument([string]$Class, [string]$Log) {
    $result = Adb shell am instrument -w -r -e genesisWidth "$widthDp" -e class "ru.genesis.calendar.$Class" $runner
    Set-Content -LiteralPath $Log -Value $result -Encoding UTF8
    return ($result -match 'OK \(' -and $result -notmatch 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed')
}
$results = [Collections.Generic.List[object]]::new()
foreach ($avd in $Avds) {
    $dir = Join-Path $report $avd
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $process = $null
    try {
        if ((& $adb devices | Out-String) -match "$serial\s") { throw "$serial already in use" }
        Write-Output "START $avd"
        $process = Start-Process -FilePath $emulator -ArgumentList @('-avd',$avd,'-port',"$Port",'-no-window',
            '-no-audio','-no-snapshot','-no-boot-anim','-memory','3072','-cores','4','-gpu','host') -WindowStyle Hidden -PassThru
        $deadline = (Get-Date).AddMinutes(6)
        do {
            Start-Sleep -Seconds 3
            if ($process.HasExited) { throw 'Emulator exited at boot' }
            $boot = & $adb -s $serial shell getprop sys.boot_completed 2>$null
        } until ($boot -eq '1' -or (Get-Date) -gt $deadline)
        if ($boot -ne '1') { throw 'Boot timed out' }
        Adb shell input keyevent 82 | Out-Null
        Adb shell svc power stayon true | Out-Null
        Adb shell settings put system screen_off_timeout 1800000 | Out-Null
        # A previous interrupted accessibility run can leave TalkBack active in the AVD.
        # Ordinary touch tests run without it; the dedicated check enables it below.
        Adb shell settings delete secure enabled_accessibility_services | Out-Null
        Adb shell settings put secure accessibility_enabled 0 | Out-Null
        Adb install -r -t $apk | Out-Null
        Adb install -r -t $testApk | Out-Null
        $api = [int](Adb shell getprop ro.build.version.sdk)
        $size = Adb shell wm size
        $density = Adb shell wm density
        $pixels = [int]([regex]::Matches($size, '(\d+)x\d+')[-1].Groups[1].Value)
        $dpi = [int]([regex]::Matches($density, '\d+')[-1].Value)
        $widthDp = [int][math]::Round($pixels * 160.0 / $dpi)
        Adb shell settings put global window_animation_scale 0 | Out-Null
        Adb shell settings put global transition_animation_scale 0 | Out-Null
        Adb shell settings put global animator_duration_scale 1 | Out-Null
        Set-Content "$dir/device.txt" -Value @("AVD=$avd", "API=$api", (Adb shell wm size), (Adb shell wm density))
        Start-Sleep -Seconds 20
        foreach ($class in $classes) {
            Adb shell pm clear $package | Out-Null
            if ($api -ge 33) { Adb shell pm grant $package android.permission.POST_NOTIFICATIONS | Out-Null }
            $passed = Instrument $class "$dir/$class.txt"
            $results.Add([pscustomobject]@{avd=$avd; api=$api; test=$class; passed=$passed})
            $results | ConvertTo-Json -Depth 5 | Set-Content "$report/results-$Port.json" -Encoding UTF8
            Write-Output "$avd $class $passed"
            if (!$passed -or $class -in @('LanguageGridTest','CalendarModeHeaderTest','ResponsiveWorkspaceTest')) {
                $exportLog = & $adb -s $serial pull "/sdcard/Android/data/$package/files/" "$dir/screenshots-$class" 2>&1 | Out-String
                $exportFailed = $LASTEXITCODE -ne 0
                # Android 11 emulator images can deny shell access to external app files.
                if ($exportFailed -and $api -eq 30 -and $exportLog -match 'Permission denied') {
                    try {
                        Adb root | Out-Null
                        Adb wait-for-device | Out-Null
                        $exportLog += & $adb -s $serial pull "/sdcard/Android/data/$package/files/" "$dir/screenshots-$class" 2>&1 | Out-String
                        $exportFailed = $LASTEXITCODE -ne 0
                    } finally {
                        Adb unroot | Out-Null
                        Adb wait-for-device | Out-Null
                    }
                }
                Set-Content -LiteralPath "$dir/screenshots-$class-export.txt" -Value $exportLog -Encoding UTF8
                if ($exportFailed) { Write-Warning "Screenshot export failed: $avd $class; see export log" }
            }
        }
        if (!$SkipReminders) {
        Adb shell pm clear $package | Out-Null
        if ($api -ge 33) { Adb shell pm grant $package android.permission.POST_NOTIFICATIONS | Out-Null }
        $armed = Instrument 'ReminderFlowTest#prepareScreenOffReminder' "$dir/flow-arm.txt"
        if ($armed) {
            Adb shell am kill $package | Out-Null
            Start-Sleep -Seconds 50
            Start-Sleep -Seconds 50
            $delivered = Instrument 'ReminderFlowTest#verifyDeliveredAndCompleteAction' "$dir/flow-delivered.txt"
            $persisted = Instrument 'ReminderFlowTest#persistedCompletionSurvivesFreshProcess' "$dir/flow-persisted.txt"
            $results.Add([pscustomobject]@{avd=$avd; api=$api; test='ReminderFlowDelivery'; passed=($delivered -and $persisted)})
        } else { $results.Add([pscustomobject]@{avd=$avd; api=$api; test='ReminderFlowDelivery'; passed=$false}) }
        foreach ($method in @('notificationOpensTheStoredRecord','snoozeAndStaleVersionAreIdempotent','fiveRemindersPersistAndCancelTogether','notificationChannelDiagnostics')) {
            $passed = Instrument "ReminderFlowTest#$method" "$dir/flow-$method.txt"
            $results.Add([pscustomobject]@{avd=$avd; api=$api; test="ReminderFlowTest#$method"; passed=$passed})
        }
        $passed = Instrument 'NotificationReliabilityTest#batterySettingsIntentsAreScopedAndSamsungAware'  "$dir/battery-intents.txt"
        $results.Add([pscustomobject]@{avd=$avd; api=$api; test="BatterySettingsIntents"; passed=$passed})
        $armed = Instrument 'NotificationReliabilityTest#armDiagnosticAlarm' "$dir/reminder-arm.txt"
        Adb shell am kill $package | Out-Null
        Start-Sleep -Seconds 35
        $delivered = Instrument 'NotificationReliabilityTest#verifyDiagnosticAfterProcessDeath' "$dir/reminder-delivered.txt"
        $results.Add([pscustomobject]@{avd=$avd; api=$api; test='ReminderAfterProcessDeath'; passed=($armed -and $delivered)})
        Adb shell pm clear $package | Out-Null
        if ($api -ge 33) { Adb shell pm grant $package android.permission.POST_NOTIFICATIONS | Out-Null }
        $armed = Instrument 'BackgroundReminderTest#armAccountAlarmAndPersistOfflinePreferences' "$dir/background-arm.txt"
        if ($armed) {
            Adb shell am kill $package | Out-Null
            Start-Sleep -Seconds 55
            Start-Sleep -Seconds 55
            Start-Sleep -Seconds 20
            $delivered = Instrument 'BackgroundReminderTest#verifyDeliveryAfterProcessDeathAndDurableLocalData' "$dir/background-delivered.txt"
            $results.Add([pscustomobject]@{avd=$avd; api=$api; test='BackgroundReminderTest'; passed=$delivered})
        } else { $results.Add([pscustomobject]@{avd=$avd; api=$api; test='BackgroundReminderTest'; passed=$false}) }
        }
        $talkback = (& $adb -s $serial shell pm path com.google.android.marvin.talkback 2>$null | Out-String).Trim()
        if (!$SkipAccessibility -and $talkback -and $api -ge 34) {
            Adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService | Out-Null
            Adb shell settings put secure accessibility_enabled 1 | Out-Null
            try {
                $passed = Instrument 'TalkBackAccessibilityTest' "$dir/TalkBackAccessibilityTest.txt"
                $results.Add([pscustomobject]@{avd=$avd; api=$api; test='TalkBackAccessibilityTest'; passed=$passed})
            } finally {
                Adb shell settings delete secure enabled_accessibility_services | Out-Null
                Adb shell settings put secure accessibility_enabled 0 | Out-Null
            }
        } else { Set-Content "$dir/TalkBackAccessibilityTest.txt" 'SKIP: omitted in focused retry, or requires API 34+ and an installed TalkBack service' }
    } catch {
        $results.Add([pscustomobject]@{avd=$avd; test='runner'; passed=$false; error=$_.Exception.Message})
        Write-Output "ERROR $avd $($_.Exception.Message)"
    } finally {
        $results | ConvertTo-Json -Depth 5 | Set-Content "$report/results-$Port.json" -Encoding UTF8
        if ($process) {
            try { Adb emu kill | Out-Null } catch {}
            if (!$process.HasExited) { $process.WaitForExit(30000) | Out-Null }
            $stopDeadline = (Get-Date).AddSeconds(45)
            while ((& $adb devices | Out-String) -match "$serial\s" -and (Get-Date) -lt $stopDeadline) {
                Start-Sleep -Seconds 2
            }
        }
    }
}
Write-Output "COMPLETE $report"
