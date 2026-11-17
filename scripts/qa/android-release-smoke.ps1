#requires -Version 7.4
param([switch]$SkipBuild, [string[]]$Serial=@(), [string]$RunId=('android-release-'+(Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference='Stop'
if(!$Serial.Count -or $RunId -notmatch '^[a-zA-Z0-9-]{6,80}$'){throw 'Explicit device serials and a safe run ID are required'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'android-common.ps1')
$output=Join-Path $root "output/qa/$RunId"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
$adb=Join-Path $sdk 'platform-tools/adb.exe'
$package='ru.genesis.calendar.qa1103.release'
$sourceHash=Get-NativeSourceHash $root
if(!$SkipBuild){
    $env:JAVA_HOME=if($env:JAVA_HOME){$env:JAVA_HOME}else{'C:/Program Files/Android/Android Studio/jbr'}
    $env:ANDROID_HOME=$sdk; $env:ANDROID_SDK_ROOT=$sdk
    Push-Location (Join-Path $root 'android')
    try {
        & ./gradlew.bat --no-daemon --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx6g -Dfile.encoding=COMPAT' '-Pkotlin.compiler.execution.strategy=in-process' '-PgenesisDebugApplicationIdSuffix=.qa1103.debug' '-PgenesisUrl=https://localhost:4443/' :app:assembleQaRelease *> (Join-Path $output 'build.log')
        if($LASTEXITCODE -ne 0){throw 'Isolated minified build failed'}
    } finally {Pop-Location}
    Save-NativeBuildIdentity $root $sourceHash 'qaRelease' | Out-Null
}
$identity=Assert-NativeBuildIdentity $root $sourceHash 'qaRelease'
$apk=Join-Path $root 'android/app/build/outputs/apk/qaRelease/app-qaRelease.apk'
$aapt=Get-ChildItem (Join-Path $sdk 'build-tools/*/aapt.exe') | Sort-Object FullName -Descending | Select-Object -First 1
$version=Get-NativeVersion $root
$metadata=(& $aapt.FullName dump badging $apk)-join "`n"
if($metadata -notmatch "package: name='$([regex]::Escape($package))' versionCode='$($version.versionCode)' versionName='$([regex]::Escape($version.versionName))'" -or $metadata -match '(?m)^application-debuggable'){
    throw 'Unexpected package, version or debug setting in the minified QA artifact'
}
$results=[System.Collections.Generic.List[object]]::new()
$devices=[System.Collections.Generic.List[object]]::new()
foreach($device in $Serial){
    if($device -notmatch '^[-A-Za-z0-9]+$'){throw 'Invalid device serial'}
    $label=if($device.StartsWith('emulator-')){$device}else{'samsung-physical'}
    $directory=Join-Path $output $label
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $failure=$null
    try {
        & $adb -s $device install -r -t $apk *> (Join-Path $directory 'install.log')
        if($LASTEXITCODE -ne 0){throw 'Minified QA installation failed'}
        # Only this explicitly isolated test package is reset; the main app is never addressed.
        $cleared=(& $adb -s $device shell pm clear --user 0 $package)-join ''
        if($LASTEXITCODE -ne 0 -or $cleared -notmatch 'Success'){throw 'Isolated QA reset failed'}
        & $adb -s $device shell input keyevent KEYCODE_WAKEUP | Out-Null
        & $adb -s $device shell wm dismiss-keyguard | Out-Null
        for($launch=1;$launch -le 2;$launch++){
            $component=((& $adb -s $device shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER $package) | Where-Object {$_ -match '^ru\.genesis\.calendar\.qa1103\.release/' } | Select-Object -Last 1).Trim()
            if(!$component){throw 'No isolated launcher was resolved'}
            # Android 8 can wait forever in `am start -W` when a NoDisplay launcher
            # returns to an already resumed activity. Observe the real foreground instead.
            & $adb -s $device shell am start -n $component *> (Join-Path $directory "launch-$launch.log")
            if($LASTEXITCODE -ne 0){throw 'Launcher command failed'}
            $deadline=[DateTimeOffset]::UtcNow.AddSeconds(20)
            $stablePolls=0
            do {
                $activity=(& $adb -s $device shell dumpsys activity activities)-join "`n"
                $resumed=($activity -split "`n" | Where-Object {$_ -match 'mResumedActivity|topResumedActivity'})-join "`n"
                $stablePolls=if($resumed -match ([regex]::Escape("$package/ru.genesis.calendar.MainActivity"))){$stablePolls+1}else{0}
                $stable=$stablePolls -ge 3
                if(!$stable){Start-Sleep -Milliseconds 250}
            }until($stable -or [DateTimeOffset]::UtcNow -gt $deadline)
            if(!$stable){throw 'The permanent MainActivity did not become foreground'}
            $activity | Set-Content (Join-Path $directory "activity-$launch.txt") -Encoding utf8
        }
        $appPid=((& $adb -s $device shell pidof $package)-join '').Trim()
        if($appPid -notmatch '^\d+$'){throw 'Minified process exited'}
        $errors=(& $adb -s $device logcat -d -v brief "--pid=$appPid" 'AndroidRuntime:E' '*:S')-join "`n"
        $errors | Set-Content (Join-Path $directory 'runtime-errors.log') -Encoding utf8
        if($errors -match 'FATAL EXCEPTION'){throw 'Minified startup raised an uncaught exception'}
        & $adb -s $device exec-out screencap -p > (Join-Path $directory 'startup.png')
    } catch {$failure=$_.Exception.Message}
    finally {
        & $adb -s $device shell am force-stop $package | Out-Null
        & $adb -s $device shell pm clear --user 0 $package | Out-Null
    }
    $devices.Add([ordered]@{serial=$device;label=$label;api=(((& $adb -s $device shell getprop ro.build.version.sdk)-join '').Trim())})
    $results.Add([ordered]@{device=$label;class='MinifiedLauncherStartup';status=if($failure){'FAIL'}else{'PASS'};passed=if($failure){0}else{2};failed=if($failure){1}else{0};reason=$failure})
}
$failed=@($results | Where-Object status -ne 'PASS').Count
[ordered]@{runId=$RunId;package=$package;version=$version;sourceCommit=(& git -C $root rev-parse HEAD);nativeSourceHash=$sourceHash;runnerSourceHash=(Get-NativeRunnerHash $root);build=$identity;devices=@($devices);results=@($results);status=if($failed){'INCOMPLETE'}else{'PASS_LOCAL_SCOPE'}} |
    ConvertTo-Json -Depth 12 | Set-Content (Join-Path $output 'results.json') -Encoding utf8
if($failed){exit 1}
