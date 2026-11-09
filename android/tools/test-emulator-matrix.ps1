param(
    [ValidateSet("phones", "tablets", "all")]
    [string]$Mode = "all",
    [switch]$Force,
    [string]$Apk = "$PSScriptRoot/../app/build/outputs/apk/debug/app-debug.apk",
    [string]$TestApk = "$PSScriptRoot/../app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
)

$ErrorActionPreference = "Stop"
$androidStudioJbr = "C:/Program Files/Android/Android Studio/jbr"
if ((!$env:JAVA_HOME -or !(Test-Path -LiteralPath "$env:JAVA_HOME/bin/java.exe")) -and
    (Test-Path -LiteralPath "$androidStudioJbr/bin/java.exe")) {
    $env:JAVA_HOME = $androidStudioJbr
}
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA/Android/Sdk" }
$adb = "$sdk/platform-tools/adb.exe"
$emulator = "$sdk/emulator/emulator.exe"
$avdManager = "$sdk/cmdline-tools/latest/bin/avdmanager.bat"
$package = "ru.genesis.calendar.debug"
$runner = "$package.test/androidx.test.runner.AndroidJUnitRunner"
$reportDir = "$PSScriptRoot/../build/reports/emulator-matrix-2.4.0"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

foreach ($required in @($adb, $emulator, $avdManager, $Apk, $TestApk)) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing required file: $required" }
}

function Invoke-Adb {
    $Arguments = @($args)
    $output = if ($Arguments[0] -eq "devices") {
        & $adb @Arguments 2>&1 | Out-String
    } else {
        & $adb -e @Arguments 2>&1 | Out-String
    }
    if ($LASTEXITCODE -ne 0) { throw "adb $($Arguments -join ' ') failed:`n$output" }
    return $output.Trim()
}

function Invoke-Instrumentation([string]$Classes, [string]$Log) {
    $output = Invoke-Adb shell am instrument -w -r -e class $Classes $runner
    Add-Content -LiteralPath $Log -Value $output
    if ($output -match "FAILURES!!!|INSTRUMENTATION_FAILED" -or $output -notmatch "OK \(") {
        throw "Instrumentation failed for $Classes. See $Log"
    }
}

function Ensure-Avd([string]$Name, [int]$Api, [string]$Device) {
    $listed = & $emulator -list-avds
    if ($listed -contains $Name) { return }
    $image = "system-images;android-$Api;google_apis;x86_64"
    "no" | & $avdManager create avd --name $Name --package $image --device $Device --force | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create $Name from $image" }
    $listed = & $emulator -list-avds
    if ($listed -notcontains $Name) { throw "avdmanager did not create $Name with device profile $Device" }
}

function Wait-For-Boot($Process) {
    $deviceDeadline = (Get-Date).AddMinutes(2)
    do {
        if ($Process.HasExited) { throw "Emulator exited before ADB became available" }
        $deviceList = (& $adb devices 2>&1 | Out-String)
        $state = if ($deviceList -match "emulator-\d+\s+device") { "device" } else { "" }
        if ($state -ne "device") { Start-Sleep -Seconds 2 }
    } until ($state -eq "device" -or (Get-Date) -ge $deviceDeadline)
    if ($state -ne "device") { throw "Emulator did not become available to ADB within two minutes" }
    $deadline = (Get-Date).AddMinutes(5)
    do {
        Start-Sleep -Seconds 2
        $ready = (& $adb -e shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    } until ($ready -eq "1" -or (Get-Date) -ge $deadline)
    if ($ready -ne "1") { throw "Emulator did not boot within five minutes" }
    Invoke-Adb shell input keyevent 82 | Out-Null
}

function Start-MatrixAvd([string]$Name, [int]$Api, [string]$Device,
    [bool]$WipeData = $true, [string]$Gpu = "software") {
    Ensure-Avd $Name $Api $Device
    $arguments = @("-avd", $Name, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot",
        "-memory", "4096", "-cores", "4", "-gpu", $Gpu)
    if ($WipeData) { $arguments += "-wipe-data" }
    $process = Start-Process -FilePath $emulator -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try { Wait-For-Boot $process } catch { if (!$process.HasExited) { $process.Kill() }; throw }
    return $process
}

function Install-TestPackages([int]$Api) {
    Invoke-Adb install -r -t $Apk | Out-Null
    Invoke-Adb install -r -t $TestApk | Out-Null
    if ($Api -ge 33) { Invoke-Adb shell pm grant $package android.permission.POST_NOTIFICATIONS | Out-Null }
}

function Wait-For-TestRuntime {
    Invoke-Adb shell settings put global window_animation_scale 0 | Out-Null
    Invoke-Adb shell settings put global transition_animation_scale 0 | Out-Null
    Invoke-Adb shell settings put global animator_duration_scale 0 | Out-Null
    # Fresh tablet images continue package optimization and first-boot jobs after
    # sys.boot_completed. Starting instrumentation immediately can trigger an Android
    # startup ANR in an otherwise healthy app while system_server is saturated.
    $deadline = (Get-Date).AddMinutes(5)
    $stableSamples = 0
    do {
        Start-Sleep -Seconds 10
        $loadAverage = (Invoke-Adb shell cat /proc/loadavg).Split(' ')[0]
        $load = [double]::Parse($loadAverage, [Globalization.CultureInfo]::InvariantCulture)
        if ($load -lt 4.0) { $stableSamples++ } else { $stableSamples = 0 }
    } until ($stableSamples -ge 2 -or (Get-Date) -ge $deadline)
    if ($stableSamples -lt 2) { throw "Tablet emulator did not become idle within five minutes (load $loadAverage)" }
}

function Stop-MatrixAvd($Process) {
    try { Invoke-Adb emu kill | Out-Null } catch { }
    if ($Process -and !$Process.HasExited) { $Process.WaitForExit(30000) | Out-Null }
}

function Add-FailureDiagnostics([string]$Log) {
    try {
        if ((& $adb devices 2>&1 | Out-String) -notmatch "emulator-\d+\s+device") {
            Add-Content -LiteralPath $Log -Value "Emulator disconnected before logcat could be captured"
            return
        }
        Add-Content -LiteralPath $Log -Value "`n=== device logcat after failure ==="
        Add-Content -LiteralPath $Log -Value (Invoke-Adb logcat -d -t 500)
    } catch {
        Add-Content -LiteralPath $Log -Value "Could not capture device logcat: $($_.Exception.Message)"
    }
}

function Test-TalkBackIfAvailable([string]$Log) {
    $talkBack = Invoke-Adb shell pm path com.google.android.marvin.talkback
    if (!$talkBack) {
        Add-Content -LiteralPath $Log -Value "TalkBack package unavailable on this system image: SKIP"
        return
    }
    try {
        Invoke-Adb shell settings put secure enabled_accessibility_services `
            com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService | Out-Null
        Invoke-Adb shell settings put secure accessibility_enabled 1 | Out-Null
        Invoke-Instrumentation "ru.genesis.calendar.TalkBackAccessibilityTest" $Log
    } finally {
        Invoke-Adb shell settings delete secure enabled_accessibility_services | Out-Null
        Invoke-Adb shell settings put secure accessibility_enabled 0 | Out-Null
    }
}

function Test-Phone([int]$Api, [string]$Device) {
    $name = "GenesisMatrix_API${Api}_Phone"
    $log = "$reportDir/$name.txt"
    if (!$Force -and (Test-Path -LiteralPath $log) -and (Get-Content -LiteralPath $log -Tail 1) -eq "PASS") {
        Write-Host "$name already passed"
        return
    }
    Set-Content -LiteralPath $log -Value "GENESIS 2.4.0 phone matrix: API $Api, device $Device"
    $process = $null
    try {
        $process = Start-MatrixAvd $name $Api $Device
        Install-TestPackages $Api
        Add-Content -LiteralPath $log -Value (Invoke-Adb shell wm size)
        Add-Content -LiteralPath $log -Value (Invoke-Adb shell wm density)
        Invoke-Instrumentation (
            "ru.genesis.calendar.NotificationReliabilityTest#batterySettingsIntentsAreScopedAndSamsungAware," +
            "ru.genesis.calendar.ReminderFallbackWorkTest," +
            "ru.genesis.calendar.HabitReminderRecoveryTest," +
            "ru.genesis.calendar.NotificationRouteTest," +
            "ru.genesis.calendar.ExpiredSessionReminderTest," +
            "ru.genesis.calendar.CloudWorkspaceSyncTest," +
            "ru.genesis.calendar.NativeAuthTransportTest"
        ) $log
        Invoke-Instrumentation "ru.genesis.calendar.NotificationReliabilityTest#armDiagnosticAlarm" $log
        Invoke-Adb shell am kill $package | Out-Null
        Start-Sleep -Seconds 35
        Invoke-Instrumentation "ru.genesis.calendar.NotificationReliabilityTest#verifyDiagnosticAfterProcessDeath" $log
        if ($Api -ge 34) { Test-TalkBackIfAvailable $log }
        Add-Content -LiteralPath $log -Value "PASS"
    } catch {
        Add-FailureDiagnostics $log
        throw
    } finally { Stop-MatrixAvd $process }
}

function Test-Tablet([string]$Device) {
    $safe = $Device -replace "[^A-Za-z0-9]", "_"
    $name = "GenesisMatrix_API35_$safe"
    $log = "$reportDir/$name.txt"
    if (!$Force -and (Test-Path -LiteralPath $log) -and (Get-Content -LiteralPath $log -Tail 1) -eq "PASS") {
        Write-Host "$name already passed"
        return
    }
    Set-Content -LiteralPath $log -Value "GENESIS 2.4.0 tablet matrix: API 35, device $Device"
    $process = $null
    try {
        # Keep the already initialized Android system between tablet reruns. Clearing
        # app data preserves the package UID and avoids stale scoped-storage ownership
        # on emulator images that are reused for multiple instrumentation runs.
        $process = Start-MatrixAvd $name 35 $Device $false "host"
        if ((& $adb -e shell pm path $package 2>$null | Out-String).Trim()) {
            Invoke-Adb shell pm clear $package | Out-Null
        }
        Install-TestPackages 35
        Wait-For-TestRuntime
        Add-Content -LiteralPath $log -Value (Invoke-Adb shell wm size)
        Add-Content -LiteralPath $log -Value (Invoke-Adb shell wm density)
        Invoke-Instrumentation (
            "ru.genesis.calendar.LandscapeNavigationTest," +
            "ru.genesis.calendar.CalendarMobileLayoutTest," +
            "ru.genesis.calendar.CalendarAndTodayFlowTest"
        ) $log
        Test-TalkBackIfAvailable $log
        Add-Content -LiteralPath $log -Value "PASS"
    } catch {
        Add-FailureDiagnostics $log
        throw
    } finally { Stop-MatrixAvd $process }
}

if ((Invoke-Adb devices) -match "emulator-\d+\s+device") {
    throw "Close the running emulator before starting the isolated matrix"
}

if ($Mode -in @("phones", "all")) {
    foreach ($entry in @(
        @{ Api = 26; Device = "pixel_2" }, @{ Api = 28; Device = "pixel_2" },
        @{ Api = 29; Device = "pixel_2" }, @{ Api = 30; Device = "pixel_2" },
        @{ Api = 31; Device = "pixel_5" }, @{ Api = 32; Device = "pixel_5" },
        @{ Api = 33; Device = "pixel_7" }, @{ Api = 34; Device = "pixel_7" },
        @{ Api = 35; Device = "pixel_7" }, @{ Api = 36; Device = "pixel_9" }
    )) { Test-Phone $entry.Api $entry.Device }
}

if ($Mode -in @("tablets", "all")) {
    foreach ($device in @("small_tablet", "medium_tablet", "pixel_tablet", "pixel_fold")) {
        Test-Tablet $device
    }
}

Write-Host "GENESIS emulator matrix PASS. Reports: $reportDir"
