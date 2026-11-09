param(
    [string[]]$Serial = @(),
    [string[]]$Class = @(),
    [string]$PhysicalDeviceLabel = 'samsung-physical',
    [switch]$SkipBuild,
    [switch]$IncludeCaptures,
    [string]$MindmapFixtureDirectory = '',
    [string]$FixtureCa = '',
    [string]$RunId = ('android-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
)
$ErrorActionPreference = 'Stop'
if ($PhysicalDeviceLabel -notmatch '^[a-z][a-z0-9-]{2,48}$') { throw 'Invalid physical device label' }
if ($RunId -notmatch '^[a-zA-Z0-9-]{6,80}$') { throw 'Invalid QA run ID' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'android-common.ps1')
$nativeSourceHash = Get-NativeSourceHash $root
$runnerSourceHash = Get-NativeRunnerHash $root
$backendSourceHash = if ($FixtureCa) { Get-NativeBackendHash $root } else { $null }
$output = Join-Path $root "output/qa/$RunId"
New-Item -ItemType Directory -Path $output -Force | Out-Null
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:/Program Files/Android/Android Studio/jbr' }
$package = 'ru.genesis.calendar.qa1103.debug'
$reasons = [System.Collections.Generic.List[string]]::new()
$results = [System.Collections.Generic.List[object]]::new()
$devices = [System.Collections.Generic.List[object]]::new()
$build = [ordered]@{ status = 'NOT_RUN'; apkSha256 = $null; testApkSha256 = $null }
$taskShapeFixture = $null
$taskShapeDeviceInputs = [System.Collections.Generic.List[string]]::new()

function Run-Adb([string[]]$Arguments) {
    $value = & $adb @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "ADB command failed ($($Arguments[0])): $value" }
    return ($value -join "`n")
}
function Save-Report {
    [ordered]@{
        runId = $RunId; generatedAt = [DateTimeOffset]::UtcNow.ToString('o');
        sourceCommit = (& git -C $root rev-parse HEAD); sourceHash = $nativeSourceHash;
        nativeSourceHash = $nativeSourceHash; runnerSourceHash = $runnerSourceHash; backendSourceHash = $backendSourceHash; package = $package;
        backendOrigin = 'https://localhost:4443'; versionName = (Get-NativeVersion $root).versionName; versionCode = (Get-NativeVersion $root).versionCode;
        build = $build; taskShapeFixture = $taskShapeFixture; devices = @($devices); results = @($results); reasons = @($reasons);
        scope = 'Native Compose, Room, Keystore and local entitlement fixtures; authenticated provider E2E is reported separately.';
        status = if ($reasons.Count -or @($results | Where-Object status -ne 'PASS').Count -or !$results.Count) { 'INCOMPLETE' } else { 'PASS_LOCAL_SCOPE' }
    } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $output 'results.json') -Encoding utf8
}

try {
    if (!(Test-Path -LiteralPath $adb)) { throw 'Android SDK platform-tools/adb.exe is unavailable' }
    if (!(Test-Path -LiteralPath (Join-Path $java 'bin/java.exe'))) { throw 'JDK is unavailable' }
    $env:JAVA_HOME = $java; $env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk
    if (!$SkipBuild) {
        Push-Location (Join-Path $root 'android')
        try {
            & ./gradlew.bat --no-daemon --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx6g -Dfile.encoding=COMPAT' '-Pkotlin.compiler.execution.strategy=in-process' '-PgenesisDebugApplicationIdSuffix=.qa1103.debug' '-PgenesisUrl=https://localhost:4443/' :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest *> (Join-Path $output 'build.log')
            if ($LASTEXITCODE -ne 0) { throw 'Android unit/build failed; see build.log' }
        } finally { Pop-Location }
        Save-NativeBuildIdentity $root $nativeSourceHash | Out-Null
    }
    $identity = Assert-NativeBuildIdentity $root $nativeSourceHash
    $apk = Join-Path $root 'android/app/build/outputs/apk/debug/app-debug.apk'
    $testApk = Join-Path $root 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
    foreach ($file in @($apk, $testApk)) { if (!(Test-Path -LiteralPath $file)) { throw "Missing APK: $file" } }
    $aapt = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Filter aapt2.exe -Recurse | Sort-Object FullName -Descending | Select-Object -First 1
    if (!$aapt) { throw 'aapt2 is required to verify package isolation' }
    $manifest = & $aapt.FullName dump badging $apk
    if (($manifest -join "`n") -notmatch "package: name='$([regex]::Escape($package))'") { throw 'Refusing to install an APK with an unexpected package' }
    $version=Get-NativeVersion $root
    if (($manifest -join "`n") -notmatch "versionCode='$($version.versionCode)' versionName='$([regex]::Escape($version.versionName))'") { throw 'APK version differs from the source version' }
    $build.status = if ($SkipBuild) { 'REUSED_SOURCE_AND_APK_VERIFIED' } else { 'PASS' }
    $build.nativeSourceHash = $identity.nativeSourceHash
    $build.builtAt = $identity.builtAt
    $build.apkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
    $build.testApkSha256 = (Get-FileHash -LiteralPath $testApk -Algorithm SHA256).Hash
    $online = (Run-Adb @('devices')) -split "`n" | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] }
    if (!$Serial.Count) { $Serial = @($online) }
    if (!$Serial.Count) { throw 'No authorized Android device or emulator is online' }
    if (!$Class.Count) {
        $Class = @(
            'FullQaPlanStorageTest', 'PreferencesTest', 'TodayTaskDate314Test', 'BackHistory314Test',
            'CalendarTaskActionsTest', 'CalendarTaskStatusTest', 'TaskRecurrenceFlowTest', 'NativeUiTest',
            'ProjectsFlowTest', 'ui.SharedChaosBoxFlowTest', 'ui.WorkspaceDragHostTest', 'TaskListsFlowTest', 'CloudAccountImporterTest', 'CloudTaskSyncTest',
            'CloudWorkspaceSyncTest', 'WorkspaceConflictReviewTest', 'HabitLifecycleFlowTest',
            'HabitTimerFlowTest', 'HabitIntervalFlowTest', 'HabitMeasurementFlowTest',
            'HabitPeriodGoalFlowTest', 'HabitHistoryFlowTest', 'HabitRuleHistoryFlowTest',
            'HabitAnalysisFlowTest', 'HabitBackupFlowTest', 'HabitProtocolUpgradeTest',
            'ui.DiaryScreenTest', 'ui.MessagingScreenTest', 'ui.MindmapsIntegrationTest',
            'ui.AbstinenceHeader317Test', 'ui.CalendarVisual317Test', 'ui.DailyAdviceUiTest', 'ui.NativeAccountPlan317Test', 'ui.NativeTrialAccess317Test',
            'ui.AdaptiveDialogs316Test', 'ui.TaskDatePicker314UiTest', 'ui.TaskerDrawerTest',
            'ui.SharedTaskDetailsUiTest', 'ui.SharedProjectAccessUiTest', 'ui.SharedPlanningLifecycleUiTest',
            'ui.SharedWorkflowUiTest', 'ui.SharedGanttEditsTest', 'ui.SharedDataImportUiTest', 'ui.SharedDataExportUiTest'
        ) | ForEach-Object { 'ru.genesis.calendar.' + $_ }
    }
    if (@($Class | Where-Object { $_ -match '^ru\.genesis\.calendar\.CloudAccountImporterTest(?:#|$)' }).Count) {
        $fixtureRelative = "output/qa/$RunId/task-shapes"
        $fixtureRun = 'task-shapes-' + [Guid]::NewGuid().ToString('N')
        & node (Join-Path $PSScriptRoot 'task-shape-fixture.mjs') "--run-id=$fixtureRun" "--output=$fixtureRelative" *> (Join-Path $output 'task-shape-generator.log')
        if ($LASTEXITCODE -ne 0) { throw 'Automatic task-shape fixture generation failed; inspect task-shape-generator.log' }
        $fixtureManifestPath = Join-Path $root "$fixtureRelative/task-shape-manifest.json"
        $fixtureManifest = Get-Content -LiteralPath $fixtureManifestPath -Raw | ConvertFrom-Json
        $fixturePath = [IO.Path]::GetFullPath((Join-Path $root $fixtureManifest.fixture.path))
        $expectedFixturePath = [IO.Path]::GetFullPath((Join-Path $root "$fixtureRelative/task-shape.json"))
        if ($fixturePath -ne $expectedFixturePath -or $fixtureManifest.synthetic -ne $true -or $fixtureManifest.status -ne 'PASS' -or $fixtureManifest.cleanup.status -ne 'PASS') { throw 'Task-shape fixture provenance is invalid' }
        if ((Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash -ne $fixtureManifest.fixture.sha256) { throw 'Task-shape fixture hash mismatch' }
        $fixtureData = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
        if ($fixtureData.report.synthetic -ne $true -or $fixtureData.report.source -ne 'current-server-local-http-bootstrap' -or $fixtureData.report.totalRows -ne 39 -or @($fixtureData.tasks).Count -ne 39) { throw 'Task-shape fixture content is invalid' }
        $taskShapeFixture = [ordered]@{ manifest="$fixtureRelative/task-shape-manifest.json"; manifestSha256=(Get-FileHash -LiteralPath $fixtureManifestPath -Algorithm SHA256).Hash; path=$fixtureManifest.fixture.path; sha256=$fixtureManifest.fixture.sha256; totalRows=39; scope=$fixtureManifest.scope }
    }
    foreach ($device in $Serial) {
        if ($device -notin $online) { $reasons.Add("Device $device is not online"); continue }
        $devicePath = Join-Path $output $(if ($device.StartsWith('emulator-')) { $device } else { $PhysicalDeviceLabel })
        New-Item -ItemType Directory -Path $devicePath -Force | Out-Null
        $api = [int](Run-Adb @('-s', $device, 'shell', 'getprop', 'ro.build.version.sdk')).Trim()
        $devices.Add([ordered]@{ id = if ($device.StartsWith('emulator-')) { $device } else { $PhysicalDeviceLabel };
            api = $api; model = (Run-Adb @('-s', $device, 'shell', 'getprop', 'ro.product.model')).Trim();
            screen = (Run-Adb @('-s', $device, 'shell', 'wm', 'size')).Trim() })
        $captureWidth = $null
        $captureFont = $null
        if ($IncludeCaptures) {
            # Use the device's effective display settings, without changing user preferences.
            $sizes = [regex]::Matches((Run-Adb @('-s', $device, 'shell', 'wm', 'size')), '(?:Physical|Override) size: (\d+)x(\d+)')
            $densities = [regex]::Matches((Run-Adb @('-s', $device, 'shell', 'wm', 'density')), '(?:Physical|Override) density: (\d+)')
            if (!$sizes.Count -or !$densities.Count) { throw 'Cannot determine capture display dimensions' }
            $captureWidth = ([double]$sizes[-1].Groups[1].Value * 160 / [double]$densities[-1].Groups[1].Value).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
            $captureFont = (Run-Adb @('-s', $device, 'shell', 'settings', 'get', 'system', 'font_scale')).Trim()
            if ($captureFont -eq 'null') { $captureFont = '1.0' }
            if ($captureFont -notmatch '^\d+(?:\.\d+)?$') { throw 'Unexpected font scale' }
        }
        Run-Adb @('-s', $device, 'install', '-r', $apk) | Out-Null
        Run-Adb @('-s', $device, 'install', '-r', $testApk) | Out-Null
        foreach ($suite in $Class) {
            if ($suite -notmatch '^ru\.genesis\.calendar\.[A-Za-z0-9_.]+(?:#[A-Za-z0-9_]+)?$') { throw 'Invalid test class' }
            $label = $suite.Replace('ru.genesis.calendar.', '').Replace('#', '-')
            $log = Join-Path $devicePath "$label.log"
            # Only this task's package is cleared. The main app and all prior QA packages stay intact.
            if ($package -ne 'ru.genesis.calendar.qa1103.debug') { throw 'Isolation guard' }
            Run-Adb @('-s', $device, 'shell', 'pm', 'clear', '--user', '0', $package) | Out-Null
            if ($MindmapFixtureDirectory -and $suite -match '^ru\.genesis\.calendar\.ui\.MindmapsIntegrationTest(?:#|$)') {
                $fixtureLabel = if ($device.StartsWith('emulator-')) { $device } else { $PhysicalDeviceLabel }
                $fixturePath = [IO.Path]::GetFullPath((Join-Path $root "$MindmapFixtureDirectory/$fixtureLabel.json"))
                $fixtureBoundary = [IO.Path]::GetFullPath((Join-Path $root 'output/qa')) + [IO.Path]::DirectorySeparatorChar
                if (!$fixturePath.StartsWith($fixtureBoundary, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $fixturePath)) { throw 'Missing owned native mindmap fixture' }
                Run-Adb @('-s', $device, 'shell', 'mkdir', '-p', "/sdcard/Android/data/$package/files") | Out-Null
                Run-Adb @('-s', $device, 'push', $fixturePath, "/sdcard/Android/data/$package/files/mindmaps-fixture.json") | Out-Null
            }
            $hasTaskShapeFixture = $taskShapeFixture -and $suite -match '^ru\.genesis\.calendar\.CloudAccountImporterTest(?:#|$)'
            if ($hasTaskShapeFixture) {
                $taskShapePath = Join-Path $root $taskShapeFixture.path
                if ((Get-FileHash -LiteralPath $taskShapePath -Algorithm SHA256).Hash -ne $taskShapeFixture.sha256) { throw 'Task-shape fixture changed before device transfer' }
                Run-Adb @('-s', $device, 'shell', 'mkdir', '-p', "/sdcard/Android/data/$package/files") | Out-Null
                Run-Adb @('-s', $device, 'push', $taskShapePath, "/sdcard/Android/data/$package/files/task-shape.json") | Out-Null
                $taskShapeDeviceInputs.Add($device)
            }
            if ($api -ge 33) { Run-Adb @('-s', $device, 'shell', 'pm', 'grant', '--user', '0', $package, 'android.permission.POST_NOTIFICATIONS') | Out-Null }
            Run-Adb @('-s', $device, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP') | Out-Null
            & $adb -s $device shell wm dismiss-keyguard *> (Join-Path $devicePath "$label-dismiss-keyguard.log")
            $keyguard = Convert-NativeKeyguardPolicy (Run-Adb @('-s', $device, 'shell', 'dumpsys', 'window', 'policy'))
            $keyguard | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $devicePath "$label-keyguard.json") -Encoding utf8
            if ($keyguard.status -ne 'CLEAR') {
                $reasons.Add("$device native UI precondition is blocked by keyguard; no secure settings were changed")
                $results.Add([ordered]@{device=if($device.StartsWith('emulator-')){$device}else{$PhysicalDeviceLabel};class=$suite;status='BLOCKED';passed=0;failed=0;skipped=0;cases=@();reason='Device keyguard could not be confirmed clear';artifact="output/qa/$RunId/$(if($device.StartsWith('emulator-')){$device}else{$PhysicalDeviceLabel})/$label-keyguard.json"})
                Save-Report
                break
            }
            $started = [DateTimeOffset]::UtcNow
            $instrumentArgs = @('-s', $device, 'shell', 'am', 'instrument', '--user', '0', '-w', '-r', '-e', 'class', $suite)
            if ($IncludeCaptures) {
                if ($suite -match '^ru\.genesis\.calendar\.ui\.NativeTrialAccess317Test(?:#|$)') { $instrumentArgs += @('-e', 'genesisTrialCapture', 'true') }
                $instrumentArgs += @('-e', 'genesisDetailsCapture', 'true', '-e', 'genesisLifecycleCapture', 'true', '-e', 'genesisLifecycleWidth', $captureWidth)
                if ($suite -match '^ru\.genesis\.calendar\.ui\.DailyAdviceUiTest(?:#|$)') { $instrumentArgs += @('-e', 'genesisAdviceCapture', 'true') }
                foreach ($kind in @('Access','Import','Export','Workflow')) {
                    $width = if ($kind -eq 'Workflow') { ([math]::Min(840, [double]::Parse($captureWidth, [Globalization.CultureInfo]::InvariantCulture))).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture) } else { $captureWidth }
                    $instrumentArgs += @('-e', "genesis${kind}Capture", 'true', '-e', "genesis${kind}Width", $width, '-e', "genesis${kind}FontScale", $captureFont)
                }
            }
            if ($hasTaskShapeFixture) { $instrumentArgs += @('-e', 'redactedTaskFixture', 'true') }
            if ($FixtureCa) { $instrumentArgs += @('-e', 'genesisFullQaHttps', 'true', '-e', 'genesisFixtureCa', $FixtureCa) }
            $instrumentArgs += "$package.test/androidx.test.runner.AndroidJUnitRunner"
            $raw = & $adb @instrumentArgs 2>&1
            $exit = $LASTEXITCODE
            $text = $raw -join "`n"
            $text | Set-Content -LiteralPath $log -Encoding utf8
            $events = [regex]::Matches($text, '(?s)INSTRUMENTATION_STATUS: class=([^\r\n]+).*?INSTRUMENTATION_STATUS: test=([^\r\n]+).*?INSTRUMENTATION_STATUS_CODE: (-?\d+)')
            $completed = @($events | Where-Object { [int]$_.Groups[3].Value -le 0 })
            $failed = @($completed | Where-Object { [int]$_.Groups[3].Value -in @(-1, -2) }).Count
            $skipped = @($completed | Where-Object { [int]$_.Groups[3].Value -in @(-3, -4) }).Count
            $passed = @($completed | Where-Object { [int]$_.Groups[3].Value -eq 0 }).Count
            $status = if ($exit -ne 0 -or $failed -or $text -match 'INSTRUMENTATION_FAILED|shortMsg=|Process crashed|FAILURES!!!') { 'FAIL' }
                elseif ($skipped) { 'BLOCKED' } elseif (!$passed) { 'NOT_RUN' } else { 'PASS' }
            $cases = @($completed | ForEach-Object { [ordered]@{ class = $_.Groups[1].Value.Trim(); method = $_.Groups[2].Value.Trim();
                status = switch ([int]$_.Groups[3].Value) { 0 {'PASS'} -3 {'BLOCKED'} -4 {'BLOCKED'} default {'FAIL'} } } })
            $notApplicable = 0
            if ($api -lt 29) {
                foreach ($case in $cases) {
                    if ($case.class -eq 'ru.genesis.calendar.ui.SharedDataExportUiTest' -and $case.method -eq 'androidProviderReceivesExactUtf8Bytes' -and $case.status -eq 'BLOCKED') {
                        $case.status = 'NOT_APPLICABLE'; $case.reason = 'MediaStore.Downloads provider requires Android API29+.'; $notApplicable++
                    }
                }
                $skipped -= $notApplicable
                if ($status -eq 'BLOCKED' -and !$skipped -and $passed) { $status = 'PASS' }
            }
            $results.Add([ordered]@{ device = if ($device.StartsWith('emulator-')) { $device } else { $PhysicalDeviceLabel }; class = $suite;
                status = $status; passed = $passed; failed = $failed; skipped = $skipped; notApplicable = $notApplicable; cases = $cases;
                elapsedSeconds = [math]::Round(([DateTimeOffset]::UtcNow - $started).TotalSeconds, 2);
                log = $log.Substring($root.Length + 1).Replace('\', '/') })
            Write-Output "$device $label $status ($passed passed, $failed failed, $skipped blocked)"
            if ($MindmapFixtureDirectory -and $suite -match '^ru\.genesis\.calendar\.ui\.MindmapsIntegrationTest(?:#|$)') {
                # Session material is runtime input, never a published test artifact.
                Run-Adb @('-s', $device, 'shell', 'rm', '-f', "/sdcard/Android/data/$package/files/mindmaps-fixture.json") | Out-Null
            }
            if ($hasTaskShapeFixture) {
                $results[$results.Count - 1]['taskShapeFixture'] = $taskShapeFixture
                Run-Adb @('-s', $device, 'shell', 'rm', '-f', "/sdcard/Android/data/$package/files/task-shape.json") | Out-Null
                $taskShapeDeviceInputs.Remove($device) | Out-Null
            }
            $results[$results.Count - 1]['externalArtifacts'] = Save-NativeExternalArtifacts $adb $device $package (Join-Path $devicePath "$label-artifacts") $root
            # Capture-only tests write PNGs into the app sandbox. Pull only images,
            # never Room databases, key material, preferences or fixture sessions.
            if ($IncludeCaptures) {
                $captureFiles = & $adb -s $device shell run-as $package find files cache -type f -name '*.png' 2>$null
                $capturedImages = [System.Collections.Generic.List[string]]::new()
                foreach ($captureFile in $captureFiles) {
                    $captureFile = $captureFile.Trim()
                    if ($captureFile -notmatch '^(files|cache)/[A-Za-z0-9_./-]+\.png$' -or $captureFile -match '(?:^|/)\.\.(?:/|$)') { continue }
                    $captureOutput = Join-Path $devicePath "$label-artifacts/internal/$captureFile"
                    New-Item -ItemType Directory -Path (Split-Path $captureOutput -Parent) -Force | Out-Null
                    & $adb -s $device exec-out run-as $package cat $captureFile > $captureOutput
                    if ($LASTEXITCODE -ne 0) { throw 'Native screenshot extraction failed' }
                    $captureBytes = [IO.File]::ReadAllBytes($captureOutput)
                    if ($captureBytes.Length -lt 8 -or [Convert]::ToHexString($captureBytes[0..7]) -ne '89504E470D0A1A0A') { throw 'Native screenshot is not a valid PNG stream' }
                    $capturedImages.Add($captureOutput.Substring($root.Length + 1).Replace('\','/'))
                }
                $results[$results.Count - 1]['capturedImages'] = @($capturedImages)
                if (@($cases | Where-Object { $_.method -in @('captureNativeTaskEditor','captureProjectAccess','captureLifecycleFormsAndRecoveryStates','captureWorkflowForms','captureImport','captureExport') -and $_.status -eq 'PASS' }).Count -and !$capturedImages.Count) {
                    throw 'Successful native capture did not retain its PNG evidence'
                }
            }
            Save-Report
        }
    }
    if ((Get-NativeSourceHash $root) -ne $nativeSourceHash) { $reasons.Add('Native source changed during instrumentation') }
    if ($FixtureCa -and (Get-NativeBackendHash $root) -ne $backendSourceHash) { $reasons.Add('Backend source changed during native HTTPS tests') }
} catch { $reasons.Add($_.Exception.Message); Write-Error -ErrorAction Continue $_ }
finally {
    foreach ($fixtureDevice in @($taskShapeDeviceInputs)) {
        try { Run-Adb @('-s', $fixtureDevice, 'shell', 'rm', '-f', "/sdcard/Android/data/$package/files/task-shape.json") | Out-Null }
        catch { $reasons.Add('Task-shape device fixture cleanup failed: ' + $_.Exception.Message) }
    }
    Save-Report
}
if ($reasons.Count -or @($results | Where-Object status -ne 'PASS').Count -or !$results.Count) { exit 1 }
exit 0
