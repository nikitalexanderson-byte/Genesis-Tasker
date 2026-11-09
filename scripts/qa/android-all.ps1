#requires -Version 7.4
param([switch]$SkipBuild, [string]$RunId=('android-all-'+(Get-Date -Format 'yyyyMMdd-HHmmss')), [ValidateSet('all','emulators')][string]$DeviceScope='all')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'android-common.ps1')
$nativeSourceHash=Get-NativeSourceHash $root
$runnerSourceHash=Get-NativeRunnerHash $root
$output=Join-Path $root "output/qa/$RunId"
New-Item -ItemType Directory -Path $output -Force | Out-Null
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
$adb=Join-Path $sdk 'platform-tools/adb.exe'
$pwsh=Join-Path $PSHOME 'pwsh.exe'
$env:JAVA_HOME=if($env:JAVA_HOME){$env:JAVA_HOME}else{'C:/Program Files/Android/Android Studio/jbr'}
$env:ANDROID_HOME=$sdk;$env:ANDROID_SDK_ROOT=$sdk
$ownedProcesses=[System.Collections.Generic.List[object]]::new()
$ownedEmulators=[System.Collections.Generic.List[string]]::new()
$reverseDevices=[System.Collections.Generic.List[string]]::new()
$mindmapReverseDevices=[System.Collections.Generic.List[string]]::new()
$deviceCleanup=[System.Collections.Generic.List[object]]::new()
$failures=[System.Collections.Generic.List[string]]::new()
$serials=[System.Collections.Generic.List[string]]::new()
$reports=[ordered]@{}
$unit=$null
$legacyProcess=$null
$legacyDirectory=$null
$mindmapProcess=$null
$legacyEnv=@{}
$php=if($env:GENESIS_QA_PHP){$env:GENESIS_QA_PHP}else{Join-Path $env:LOCALAPPDATA 'Temp/genesis-full-qa-php-8.4.27/php.exe'}

function Run-NativeBatch([string]$Phase,[string]$Script,[string[]]$Extra=@()) {
    $children=@(foreach($serial in $serials){
        $label=if($serial.StartsWith('emulator-')){$serial}else{'samsung-physical'}
        $childRun="$RunId-$Phase-$label"
        $args=@('-NoProfile','-File',"scripts/qa/$Script",'-Serial',$serial,'-RunId',$childRun)+$Extra
        $process=Start-Process -FilePath $pwsh -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output "$Phase-$label.stdout.log") -RedirectStandardError (Join-Path $output "$Phase-$label.stderr.log")
        $ownedProcesses.Add($process)
        [pscustomobject]@{process=$process;runId=$childRun;label=$label}
    })
    while(@($children | Where-Object {!$_.process.HasExited}).Count){Start-Sleep -Seconds 2}
    $allResults=[System.Collections.Generic.List[object]]::new()
    $allDevices=[System.Collections.Generic.List[object]]::new()
    $reasons=[System.Collections.Generic.List[string]]::new()
    foreach($child in $children){
        $path=Join-Path $root "output/qa/$($child.runId)/results.json"
        if(!(Test-Path -LiteralPath $path)){$reasons.Add("$($child.label): no report");continue}
        $report=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if($report.nativeSourceHash -ne $nativeSourceHash){$reasons.Add("$($child.label): source hash mismatch")}
        foreach($result in $report.results){$allResults.Add($result)}
        foreach($device in $report.devices){$allDevices.Add($device)}
        foreach($reason in $report.reasons){$reasons.Add("$($child.label): $reason")}
        if($child.process.ExitCode -ne 0){$reasons.Add("$($child.label): $Phase runner returned $($child.process.ExitCode)")}
    }
    $phaseOutput=Join-Path $root "output/qa/$RunId-$Phase"
    New-Item -ItemType Directory -Path $phaseOutput -Force | Out-Null
    $status=if($reasons.Count -or @($allResults | Where-Object {$_.status -notin @('PASS','NOT_APPLICABLE')}).Count -or !$allResults.Count){'INCOMPLETE'}else{'PASS_SELECTED_NATIVE_SCOPE'}
    [ordered]@{runId="$RunId-$Phase";deviceScope=$DeviceScope;sourceCommit=(& git -C $root rev-parse HEAD);sourceHash=$nativeSourceHash;nativeSourceHash=$nativeSourceHash;runnerSourceHash=$runnerSourceHash;
        package='ru.genesis.calendar.qa1103.debug';backendOrigin='https://localhost:4443';versionName=(Get-NativeVersion $root).versionName;versionCode=(Get-NativeVersion $root).versionCode;
        build=(Assert-NativeBuildIdentity $root $nativeSourceHash);devices=@($allDevices);results=@($allResults);reasons=@($reasons);status=$status;
        childReports=@($children | ForEach-Object {"output/qa/$($_.runId)/results.json"})} |
        ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $phaseOutput 'results.json') -Encoding utf8
    $reports[$Phase]="output/qa/$RunId-$Phase/results.json"
    if($status -ne 'PASS_SELECTED_NATIVE_SCOPE'){$failures.Add("FAIL/BLOCKED: $Phase; inspect $($reports[$Phase])")}
    Write-Output "Android $Phase completed: $status"
}

try {
    if(!(Test-Path -LiteralPath $adb)){throw 'BLOCKED: Android SDK is unavailable'}
    & (Join-Path $PSScriptRoot 'android-artifacts-selftest.ps1') -RepositoryRoot $root *> (Join-Path $output 'artifact-selftest.json')
    & (Join-Path $PSScriptRoot 'android-keyguard-selftest.ps1') -RepositoryRoot $root *> (Join-Path $output 'keyguard-selftest.json')
    if(!$SkipBuild){
        if(@(Get-NetTCPConnection -LocalPort 4338 -State Listen -ErrorAction SilentlyContinue).Count){throw 'BLOCKED: legacy fixture port4338 is occupied; no existing process was stopped'}
        $legacyDirectory=(Join-Path $output 'legacy-http').Replace('\','/')
        & $php (Join-Path $PSScriptRoot 'legacy-http-fixture.php') "--dir=$legacyDirectory" '--origin=http://127.0.0.1:4338' "--run-id=$RunId-legacy" *> (Join-Path $output 'legacy-setup.log')
        if($LASTEXITCODE -ne 0){throw 'Legacy HTTP fixture setup failed; see legacy-setup.log'}
        $env:GENESIS_FULL_QA='isolated';$env:GENESIS_FULL_QA_DIR=$legacyDirectory
        $legacyProcess=Start-Process -FilePath $php -ArgumentList @('-d','disable_functions=curl_exec,mail','-S','127.0.0.1:4338','scripts/qa/backend-router.php') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output 'legacy-php.stdout.log') -RedirectStandardError (Join-Path $output 'legacy-php.stderr.log')
        $ownedProcesses.Add($legacyProcess)
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(20)
        do {$legacyReady=@(Get-NetTCPConnection -LocalPort 4338 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $legacyProcess.Id).Count -eq 1;if(!$legacyReady){Start-Sleep -Milliseconds 250}}until($legacyReady -or $legacyProcess.HasExited -or [DateTimeOffset]::UtcNow -gt $deadline)
        if(!$legacyReady){throw 'Legacy HTTP fixture did not start'}
        foreach($feature in @('IMPORT','BULK','AUTOMATIONS','CUSTOM_FIELDS','PROJECT_ACCESS','TEMPLATES')){
            $key="GENESIS_${feature}_HTTP_TEST";$legacyEnv[$key]=[Environment]::GetEnvironmentVariable($key);[Environment]::SetEnvironmentVariable($key,'http://127.0.0.1:4338')
            if($feature -ne 'TEMPLATES'){
                $file=switch($feature){'CUSTOM_FIELDS'{'native-custom-fields-http-target.json'}'PROJECT_ACCESS'{'native-project-access-http-target.json'}default{'native-export-http-target.json'}}
                $key="GENESIS_${feature}_HTTP_TARGET";$legacyEnv[$key]=[Environment]::GetEnvironmentVariable($key);[Environment]::SetEnvironmentVariable($key,"$legacyDirectory/output/$file")
            }
        }
        Push-Location (Join-Path $root 'android')
        try {
            & ./gradlew.bat --no-daemon --no-build-cache --console=plain --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx6g -Dfile.encoding=COMPAT' '-Pkotlin.compiler.execution.strategy=in-process' '-PgenesisDebugApplicationIdSuffix=.qa1103.debug' '-PgenesisUrl=https://localhost:4443/' :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:assembleQaRelease *> (Join-Path $output 'build.log')
            if($LASTEXITCODE -ne 0){throw 'FAIL: Android unit/build failed; see build.log'}
        } finally {
            Pop-Location
            if($legacyProcess -and !$legacyProcess.HasExited){$legacyProcess.Kill();$legacyProcess.WaitForExit()}
            foreach($entry in $legacyEnv.GetEnumerator()){[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value)}
        }
        Save-NativeBuildIdentity $root $nativeSourceHash | Out-Null
        Save-NativeBuildIdentity $root $nativeSourceHash 'qaRelease' | Out-Null
    }
    Assert-NativeBuildIdentity $root $nativeSourceHash | Out-Null
    Assert-NativeBuildIdentity $root $nativeSourceHash 'qaRelease' | Out-Null
    $unit=Get-NativeUnitResults $root
    $unit | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $output 'unit-results.json') -Encoding utf8
    if($unit.status -ne 'PASS'){$failures.Add("FAIL/BLOCKED: unit tests include $($unit.failed) failures and $($unit.skipped) skipped tests")}
    $online=@((& $adb devices)|Where-Object{$_ -match '^\S+\s+device\s*$'}|ForEach-Object{($_ -split '\s+')[0]})
    if($DeviceScope -eq 'all'){
        foreach($serial in $online){
            if(!$serial.StartsWith('emulator-') -and ((& $adb -s $serial shell getprop ro.product.manufacturer)-join '').Trim().ToLowerInvariant() -eq 'samsung'){$serials.Add($serial)}
        }
        if(!$serials.Count){$failures.Add('BLOCKED: authorized physical Samsung is unavailable')}
    }
    $availableAvds=& (Join-Path $sdk 'emulator/emulator.exe') -list-avds
    foreach($entry in @(@{name='GenesisMatrix_API26_Phone';port=5580;api=26},@{name='GenesisMatrix_API35_pixel_tablet';port=5582;api=35})){
        $serial="emulator-$($entry.port)"
        if($serial -notin $online){
            if($entry.name -notin $availableAvds){$failures.Add("BLOCKED: $($entry.name) unavailable");continue}
            $process=Start-Process -FilePath (Join-Path $sdk 'emulator/emulator.exe') -ArgumentList @('-avd',$entry.name,'-port',$entry.port,'-no-window','-no-snapshot','-no-audio','-no-boot-anim','-gpu','swiftshader_indirect') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output "$serial.stdout.log") -RedirectStandardError (Join-Path $output "$serial.stderr.log")
            $ownedProcesses.Add($process);$ownedEmulators.Add($serial)
        }elseif(((& $adb -s $serial emu avd name)-join "`n") -notmatch [regex]::Escape($entry.name)){
            $failures.Add("BLOCKED: $serial belongs to a different AVD");continue
        }
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(180)
        do {$ready=((& $adb -s $serial shell getprop sys.boot_completed 2>$null)-join '').Trim() -eq '1';if(!$ready){Start-Sleep -Seconds 1}}until($ready -or [DateTimeOffset]::UtcNow -gt $deadline)
        if($ready -and [int](((& $adb -s $serial shell getprop ro.build.version.sdk)-join '').Trim()) -eq $entry.api){$serials.Add($serial)}else{$failures.Add("BLOCKED: $serial boot/API check failed")}
    }
    if(!$serials.Count){throw 'BLOCKED: no requested native platform'}
    $localArguments=@('-SkipBuild','-IncludeCaptures')
    if(@(Get-NetTCPConnection -LocalPort 4341 -State Listen -ErrorAction SilentlyContinue).Count){
        $failures.Add('BLOCKED: native mindmap fixture port4341 is occupied; no existing process was stopped')
    }else{
        $mindmapRelative="output/qa/$RunId/mindmaps-http"
        $mindmapDirectory=(Join-Path $root $mindmapRelative).Replace('\','/')
        $mindmapLabels=($serials | ForEach-Object {if($_.StartsWith('emulator-')){$_}else{'samsung-physical'}})-join ','
        & $php (Join-Path $PSScriptRoot 'mindmaps-native-fixture.php') "--dir=$mindmapDirectory" '--origin=http://127.0.0.1:4341' "--run-id=$RunId-mindmaps" "--devices=$mindmapLabels" *> (Join-Path $output 'mindmaps-setup.log')
        if($LASTEXITCODE -ne 0){throw 'Native mindmap fixture setup failed; see mindmaps-setup.log'}
        $env:GENESIS_FULL_QA='isolated';$env:GENESIS_FULL_QA_DIR=$mindmapDirectory
        $mindmapProcess=Start-Process -FilePath $php -ArgumentList @('-d','disable_functions=curl_exec,mail','-S','127.0.0.1:4341','scripts/qa/backend-router.php') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output 'mindmaps-php.stdout.log') -RedirectStandardError (Join-Path $output 'mindmaps-php.stderr.log')
        $ownedProcesses.Add($mindmapProcess)
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(20)
        do{$ready=@(Get-NetTCPConnection -LocalPort 4341 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $mindmapProcess.Id).Count -eq 1;if(!$ready){Start-Sleep -Milliseconds 250}}until($ready -or $mindmapProcess.HasExited -or [DateTimeOffset]::UtcNow -gt $deadline)
        if(!$ready){throw 'Owned native mindmap HTTP listener did not start'}
        foreach($serial in $serials){& $adb -s $serial reverse tcp:4341 tcp:4341 | Out-Null;if($LASTEXITCODE -ne 0){throw 'ADB mindmap localhost reverse failed'};$mindmapReverseDevices.Add($serial)}
        $localArguments+=@('-MindmapFixtureDirectory',"$mindmapRelative/output")
    }
    Run-NativeBatch 'local' 'android-full.ps1' $localArguments
    if($mindmapProcess -and !$mindmapProcess.HasExited){$mindmapProcess.Kill();$mindmapProcess.WaitForExit()}
    foreach($serial in $mindmapReverseDevices){& $adb -s $serial reverse --remove tcp:4341 2>$null | Out-Null}
    $mindmapReverseDevices.Clear()
    Run-NativeBatch 'notifications' 'android-notifications.ps1'

    $openssl='C:/Program Files/Git/usr/bin/openssl.exe'
    if(!(Test-Path -LiteralPath $php) -or !(Test-Path -LiteralPath $openssl)){$failures.Add('BLOCKED: PHP/OpenSSL required for native HTTPS')}
    elseif(@(Get-NetTCPConnection -LocalPort 4382,4443 -State Listen -ErrorAction SilentlyContinue).Count){$failures.Add('BLOCKED: native fixture ports 4382/4443 already occupied; no existing process was stopped')}
    else {
        $httpsResults=[System.Collections.Generic.List[object]]::new()
        $httpsDevices=[System.Collections.Generic.List[object]]::new()
        $httpsReasons=[System.Collections.Generic.List[string]]::new()
        $httpsChildren=[System.Collections.Generic.List[string]]::new()
        $httpsBackendHash=Get-NativeBackendHash $root
        $httpsBuild=$null
        foreach($serial in $serials){
            $label=if($serial.StartsWith('emulator-')){$serial}else{'samsung-physical'}
            $childRun="$RunId-https-$label"
            $fixture=(Join-Path $output "native-backend-$label").Replace('\','/')
            $httpsPhp=$null;$httpsTls=$null
            Push-Location $root
            try {
                if(@(Get-NetTCPConnection -LocalPort 4382,4443 -State Listen -ErrorAction SilentlyContinue).Count){throw 'Native HTTPS fixture ports are occupied; existing listener preserved'}
                # Trials persist for72hours and are single-use. Give EACH device fresh ordinary
                # accounts instead of resetting immutable grants/claims left by another device.
                & $php scripts/qa/backend-fixture.php "--dir=$fixture" '--origin=https://localhost:4443' "--run-id=$childRun" *> (Join-Path $output "fixture-$label-setup.log")
                if($LASTEXITCODE -ne 0){throw 'Isolated native fixture setup failed'}
                & $openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture/localhost.key" -out "$fixture/localhost.crt" -days 2 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' *> (Join-Path $output "certificate-$label.log")
                if($LASTEXITCODE -ne 0){throw 'Owned localhost certificate generation failed'}
                $httpsEnvironment=@{GENESIS_FULL_QA='isolated';GENESIS_FULL_QA_DIR=$fixture}
                $httpsPhp=Start-Process -FilePath $php -ArgumentList @('-d','disable_functions=curl_exec,mail','-S','127.0.0.1:4382','scripts/qa/backend-router.php') -WorkingDirectory $root -Environment $httpsEnvironment -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output "https-$label-php.stdout.log") -RedirectStandardError (Join-Path $output "https-$label-php.stderr.log")
                $ownedProcesses.Add($httpsPhp)
                $httpsTls=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('scripts/qa/android-https-proxy.mjs') -WorkingDirectory $root -Environment $httpsEnvironment -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output "https-$label-tls.stdout.log") -RedirectStandardError (Join-Path $output "https-$label-tls.stderr.log")
                $ownedProcesses.Add($httpsTls)
                $deadline=[DateTimeOffset]::UtcNow.AddSeconds(20)
                do {
                    $phpListeners=@(Get-NetTCPConnection -LocalPort 4382 -State Listen -ErrorAction SilentlyContinue)
                    $tlsListeners=@(Get-NetTCPConnection -LocalPort 4443 -State Listen -ErrorAction SilentlyContinue)
                    $listening=$phpListeners.Count -eq 1 -and $tlsListeners.Count -eq 1 -and $phpListeners[0].OwningProcess -eq $httpsPhp.Id -and $tlsListeners[0].OwningProcess -eq $httpsTls.Id
                    if(!$listening){Start-Sleep -Milliseconds 250}
                }until($listening -or $httpsPhp.HasExited -or $httpsTls.HasExited -or [DateTimeOffset]::UtcNow -gt $deadline)
                if(!$listening){throw 'Native fixture failed to listen on its two owned ports'}
                $certificate=((Get-Content -LiteralPath "$fixture/localhost.crt")|Where-Object{$_ -notmatch '^-----'})-join ''
                $existingReverse=(& $adb -s $serial reverse --list 2>&1)-join "`n"
                if($LASTEXITCODE -ne 0 -or $existingReverse -match '(?m)\stcp:4443\s+'){throw 'ADB reverse unavailable or already owned; existing mapping preserved'}
                & $adb -s $serial reverse tcp:4443 tcp:4443 | Out-Null
                if($LASTEXITCODE -ne 0){throw 'ADB localhost reverse failed'}
                $reverseDevices.Add($serial)
                & (Join-Path $PSScriptRoot 'android-full.ps1') -SkipBuild -Serial @($serial) -Class @('ru.genesis.calendar.auth.FullQaNativeHttpsTest') -FixtureCa $certificate -RunId $childRun
                $childExit=$LASTEXITCODE
                $childPath="output/qa/$childRun/results.json";$httpsChildren.Add($childPath)
                if(!(Test-Path -LiteralPath (Join-Path $root $childPath))){throw 'Native HTTPS child produced no report'}
                $childReport=Get-Content -LiteralPath (Join-Path $root $childPath) -Raw|ConvertFrom-Json
                if($childReport.nativeSourceHash -ne $nativeSourceHash -or $childReport.runnerSourceHash -ne $runnerSourceHash -or $childReport.backendSourceHash -ne $httpsBackendHash){$httpsReasons.Add("$label source/runner/backend hash mismatch")}
                foreach($result in $childReport.results){$httpsResults.Add($result)}
                foreach($device in $childReport.devices){$httpsDevices.Add($device)}
                foreach($reason in $childReport.reasons){$httpsReasons.Add("${label}: $reason")}
                if($null -eq $httpsBuild){$httpsBuild=$childReport.build}
                if($childExit -ne 0){$httpsReasons.Add("$label HTTPS runner returned $childExit")}
            } catch {$httpsReasons.Add("${label}: $($_.Exception.Message)");Write-Error -ErrorAction Continue $_}
            finally {
                foreach($owned in @($httpsTls,$httpsPhp)){if($null -ne $owned -and !$owned.HasExited){$owned.Kill();$owned.WaitForExit()}}
                if($serial -in $reverseDevices){
                    & $adb -s $serial reverse --remove tcp:4443 2>$null | Out-Null
                    if($LASTEXITCODE -eq 0){$reverseDevices.Remove($serial)|Out-Null}else{$httpsReasons.Add("$label owned reverse cleanup failed; global cleanup will retry")}
                }
                Pop-Location
            }
        }
        $httpsOutput=Join-Path $root "output/qa/$RunId-https"
        New-Item -ItemType Directory -Path $httpsOutput -Force|Out-Null
        $httpsStatus=if($httpsReasons.Count -or $httpsDevices.Count -ne $serials.Count -or @($httpsResults|Where-Object status -ne 'PASS').Count -or !$httpsResults.Count){'INCOMPLETE'}else{'PASS_LOCAL_SCOPE'}
        [ordered]@{runId="$RunId-https";sourceCommit=(& git -C $root rev-parse HEAD);sourceHash=$nativeSourceHash;nativeSourceHash=$nativeSourceHash;runnerSourceHash=$runnerSourceHash;backendSourceHash=$httpsBackendHash;
            package='ru.genesis.calendar.qa1103.debug';backendOrigin='https://localhost:4443';versionName=(Get-NativeVersion $root).versionName;versionCode=(Get-NativeVersion $root).versionCode;
            build=$httpsBuild;devices=@($httpsDevices);results=@($httpsResults);reasons=@($httpsReasons);status=$httpsStatus;
            freshBackendPerDevice=$true;claimsReset=$false;childReports=@($httpsChildren);
            scope='Existing native HTTPS class on ordinary synthetic accounts; new immutable trial transport verified per device.'}|
            ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $httpsOutput 'results.json') -Encoding utf8
        $reports.https="output/qa/$RunId-https/results.json"
        if($httpsStatus -ne 'PASS_LOCAL_SCOPE'){$failures.Add('FAIL/BLOCKED: native HTTPS; inspect its results.json')}
    }
    & (Join-Path $PSScriptRoot 'android-release-smoke.ps1') -SkipBuild -Serial $serials.ToArray() -RunId "$RunId-release"
    $reports.release="output/qa/$RunId-release/results.json"
    if($LASTEXITCODE -ne 0){$failures.Add('FAIL/BLOCKED: minified QA release startup')}
    if((Get-NativeSourceHash $root) -ne $nativeSourceHash){$failures.Add('Native source changed during runtime verification')}
} catch {$failures.Add($_.Exception.Message);Write-Error -ErrorAction Continue $_}
finally {
    foreach($serial in $mindmapReverseDevices){& $adb -s $serial reverse --remove tcp:4341 2>$null | Out-Null}
    foreach($serial in $reverseDevices){& $adb -s $serial reverse --remove tcp:4443 2>$null | Out-Null}
    # Evidence has already been pulled. Remove synthetic app data and scheduled
    # alarms only from this task's two package IDs, including after failures.
    foreach($serial in $serials){
        foreach($qaPackage in @('ru.genesis.calendar.qa1103.debug','ru.genesis.calendar.qa1103.release')){
            $cleared=(& $adb -s $serial shell pm clear --user 0 $qaPackage 2>&1)-join "`n"
            $ok=$LASTEXITCODE -eq 0 -and $cleared -match 'Success'
            $deviceCleanup.Add([ordered]@{device=if($serial.StartsWith('emulator-')){$serial}else{'samsung-physical'};package=$qaPackage;status=if($ok){'PASS'}else{'FAIL'}})
            if(!$ok){$failures.Add("Cleanup failed for isolated $qaPackage on $serial")}
        }
    }
    foreach($serial in $ownedEmulators){& $adb -s $serial emu kill 2>$null | Out-Null}
    foreach($process in $ownedProcesses){if(!$process.HasExited){$process.Kill()}}
    [ordered]@{runId=$RunId;deviceScope=$DeviceScope;excludedPlatforms=@(if($DeviceScope -eq 'emulators'){'samsung-physical'});sourceCommit=(& git -C $root rev-parse HEAD);sourceHash=$nativeSourceHash;nativeSourceHash=$nativeSourceHash;runnerSourceHash=$runnerSourceHash;
        status=if($failures.Count){'INCOMPLETE'}else{'PASS_SELECTED_NATIVE_SCOPE'};reasons=@($failures);deviceCleanup=@($deviceCleanup);
        localReport=$reports.local;httpsReport=$reports.https;notificationsReport=$reports.notifications;releaseReport=$reports.release;unitReport="output/qa/$RunId/unit-results.json";
        limitations=@('Provider credentials are not loaded into this isolated runtime; existing external sandbox configuration is not assessed.','Ordinary server identity is synthetic; real provider sign-in is not claimed.','A local test is not authenticated UI E2E.','Main application and user data remain untouched.','No deployment, SSH, store upload or production request.')} |
        ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $output 'android-summary.json') -Encoding utf8
}
if($failures.Count){exit 1}
exit 0
