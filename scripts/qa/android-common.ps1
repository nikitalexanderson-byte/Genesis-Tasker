#requires -Version 7.4
function Convert-NativeKeyguardPolicy([string]$Policy) {
    # Do not infer an unlocked device from app focus: Samsung may focus the app behind its lockscreen.
    $showingMatch = [regex]::Match($Policy, '(?m)^\s*showing=(true|false)\s*$')
    $restrictedMatch = [regex]::Match($Policy, '(?m)^\s*inputRestricted=(true|false)\s*$')
    $known = $showingMatch.Success -and $restrictedMatch.Success
    $showing = if ($showingMatch.Success) { $showingMatch.Groups[1].Value -eq 'true' } else { $null }
    $restricted = if ($restrictedMatch.Success) { $restrictedMatch.Groups[1].Value -eq 'true' } else { $null }
    [pscustomobject]@{ known = $known; showing = $showing; inputRestricted = $restricted;
        status = if (!$known) { 'UNKNOWN' } elseif ($showing -or $restricted) { 'LOCKED' } else { 'CLEAR' } }
}

function Get-NativeVersion([string]$RepositoryRoot) {
    $gradle = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'android/app/build.gradle.kts') -Raw
    $name = [regex]::Match($gradle, '(?m)^\s*versionName\s*=\s*"([^"]+)"')
    $code = [regex]::Match($gradle, '(?m)^\s*versionCode\s*=\s*(\d+)')
    if (!$name.Success -or !$code.Success) { throw 'Cannot identify current Android version' }
    return @{ versionName = $name.Groups[1].Value; versionCode = [int]$code.Groups[1].Value }
}

# Hash actual native inputs, including the byte-copied web resources from genesisAssets.
function Get-NativeSourceHash([string]$RepositoryRoot) {
    $paths = @(& git -C $RepositoryRoot -c core.quotepath=false ls-files --cached --others --exclude-standard -- android public 'app/*.json' 'app/**/*.json' app/solar-model-localization.js server/resources/feature-access-policy.json server/resources/advice-age-access-policy.json server/resources/billing-catalog.json) | Sort-Object -Unique
    if ($LASTEXITCODE -ne 0 -or !$paths.Count) { throw 'Cannot enumerate native build inputs' }
    $lines = foreach ($relative in $paths) {
        $path = Join-Path $RepositoryRoot $relative
        if (Test-Path -LiteralPath $path -PathType Leaf) { "$relative=$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)" }
        else { "$relative=MISSING" }
    }
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))
}
function Get-NativeRunnerHash([string]$RepositoryRoot) {
    $lines = Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'scripts/qa') -Filter 'android-*' -File |
        Sort-Object Name | ForEach-Object { "$($_.Name)=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))
}
function Get-NativeBackendHash([string]$RepositoryRoot) {
    $paths=@(& git -C $RepositoryRoot -c core.quotepath=false ls-files --cached --others --exclude-standard -- server scripts/qa/backend-fixture.php scripts/qa/backend-router.php scripts/qa/android-https-proxy.mjs) | Sort-Object -Unique
    $lines=foreach($relative in $paths){
        $path=Join-Path $RepositoryRoot $relative
        if(Test-Path -LiteralPath $path -PathType Leaf){"$relative=$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)"}else{"$relative=MISSING"}
    }
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))
}
function Save-NativeBuildIdentity([string]$RepositoryRoot, [string]$SourceHash, [string]$Variant = 'debug') {
    if ((Get-NativeSourceHash $RepositoryRoot) -ne $SourceHash) { throw 'Native source changed during build; rebuild before testing' }
    $paths = if ($Variant -eq 'debug') { @('android/app/build/outputs/apk/debug/app-debug.apk', 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk') }
        elseif ($Variant -eq 'qaRelease') { @('android/app/build/outputs/apk/qaRelease/app-qaRelease.apk', 'android/app/build/outputs/mapping/qaRelease/mapping.txt') }
        else { throw 'Unknown isolated build variant' }
    $artifacts = @($paths | ForEach-Object { [ordered]@{ path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $RepositoryRoot $_) -Algorithm SHA256).Hash } })
    $record = [ordered]@{ sourceCommit=(& git -C $RepositoryRoot rev-parse HEAD); nativeSourceHash=$SourceHash; variant=$Variant;
        builtAt=[DateTimeOffset]::UtcNow.ToString('o'); origin='https://localhost:4443'; artifacts=$artifacts }
    New-Item -ItemType Directory -Path (Join-Path $RepositoryRoot 'output/qa') -Force | Out-Null
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $RepositoryRoot "output/qa/android-build-$Variant.json") -Encoding utf8
    return $record
}
function Assert-NativeBuildIdentity([string]$RepositoryRoot, [string]$SourceHash, [string]$Variant = 'debug') {
    $path = Join-Path $RepositoryRoot "output/qa/android-build-$Variant.json"
    if (!(Test-Path -LiteralPath $path)) { throw 'Missing native build identity. Run without -SkipBuild first.' }
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($record.nativeSourceHash -ne $SourceHash -or $record.variant -ne $Variant -or $record.origin -ne 'https://localhost:4443') { throw 'Native APK identity differs from current sources or requested origin; rebuild first' }
    foreach ($artifact in $record.artifacts) {
        if ((Get-FileHash -LiteralPath (Join-Path $RepositoryRoot $artifact.path) -Algorithm SHA256).Hash -ne $artifact.sha256) { throw 'APK or R8 mapping changed since the recorded build' }
    }
    return $record
}
function Get-NativeUnitResults([string]$RepositoryRoot) {
    $files = @(Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'android/app/build/test-results/testDebugUnitTest') -Filter 'TEST-*.xml' -File -ErrorAction SilentlyContinue)
    $cases = @($files | ForEach-Object {
        [xml]$xml = Get-Content -LiteralPath $_.FullName -Raw
        foreach ($test in $xml.testsuite.testcase) {
            [ordered]@{ class=[string]$test.classname; method=[string]$test.name;
                status=if($test.failure -or $test.error){'FAIL'}elseif($null -ne $test.skipped){'BLOCKED'}else{'PASS'} }
        }
    })
    return [ordered]@{ suites=$files.Count; tests=$cases.Count; passed=@($cases | Where-Object status -eq 'PASS').Count;
        failed=@($cases | Where-Object status -eq 'FAIL').Count; skipped=@($cases | Where-Object status -eq 'BLOCKED').Count; cases=$cases;
        status=if(!$cases.Count){'NOT_RUN'}elseif(@($cases | Where-Object status -eq 'FAIL').Count){'FAIL'}elseif(@($cases | Where-Object status -eq 'BLOCKED').Count){'BLOCKED'}else{'PASS'} }
}
function Convert-NativeInstrumentation([string]$Text, [int]$ExitCode) {
    $events = [regex]::Matches($Text, '(?s)INSTRUMENTATION_STATUS: class=([^\r\n]+).*?INSTRUMENTATION_STATUS: test=([^\r\n]+).*?INSTRUMENTATION_STATUS_CODE: (-?\d+)')
    $completed = @($events | Where-Object { [int]$_.Groups[3].Value -le 0 })
    $cases = @($completed | ForEach-Object { [ordered]@{ class=$_.Groups[1].Value.Trim();method=$_.Groups[2].Value.Trim();
        status=switch([int]$_.Groups[3].Value){0{'PASS'} -3{'BLOCKED'} -4{'BLOCKED'} default{'FAIL'}} } })
    $failed=@($cases | Where-Object status -eq 'FAIL').Count
    $skipped=@($cases | Where-Object status -eq 'BLOCKED').Count
    $passed=@($cases | Where-Object status -eq 'PASS').Count
    return [ordered]@{ status=if($ExitCode -ne 0 -or $failed -or $Text -match 'INSTRUMENTATION_FAILED|shortMsg=|Process crashed|FAILURES!!!'){'FAIL'}elseif($skipped){'BLOCKED'}elseif(!$passed){'NOT_RUN'}else{'PASS'};
        passed=$passed;failed=$failed;skipped=$skipped;cases=$cases }
}

# adb's Windows file writer can reject a long destination even when PowerShell
# supports it. Keep adb's path short, then move verified files with .NET/PowerShell.
function Save-NativeExternalArtifacts([string]$Adb, [string]$Serial, [string]$Package,
    [string]$Destination, [string]$RepositoryRoot) {
    if ($Package -ne 'ru.genesis.calendar.qa1103.debug') { throw 'External artifact isolation guard' }
    $boundary = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'output/qa')) + [IO.Path]::DirectorySeparatorChar
    $target = [IO.Path]::GetFullPath($Destination)
    if (!$target.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Artifact destination is outside output/qa' }
    if (Test-Path -LiteralPath $target) { throw 'Artifact destination already exists; use a fresh run ID' }
    $remote = "/sdcard/Android/data/$Package/files"
    $probe = (& $Adb -s $Serial shell "if test -d $remote; then echo present; else echo absent; fi" 2>&1) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or $probe.Trim() -notin @('present','absent')) { throw 'Cannot inspect external artifact directory' }
    if ($probe.Trim() -eq 'absent') { return [ordered]@{ status='NOT_APPLICABLE'; files=@(); reason='This suite produced no external artifact directory.' } }
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $stage = [IO.Path]::GetFullPath((Join-Path $temporaryRoot ('genesis-qa-pull-' + [Guid]::NewGuid().ToString('N'))))
    if (!$stage.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $stage)) { throw 'Artifact staging isolation guard' }
    New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
    try {
        $stagedFiles = Join-Path $stage 'files'
        $pull = & $Adb -s $Serial pull $remote $stagedFiles 2>&1
        $pullExit = $LASTEXITCODE
        if ($pullExit -ne 0 -or !(Test-Path -LiteralPath $stagedFiles -PathType Container)) {
            throw "External artifact pull failed (exit $pullExit)"
        }
        $files = @(Get-ChildItem -LiteralPath $stagedFiles -Recurse -File | ForEach-Object {
            [ordered]@{ relative=[IO.Path]::GetRelativePath($stagedFiles,$_.FullName); bytes=$_.Length;
                sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        })
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        # Both absolute paths have been checked against their explicit owned roots.
        Move-Item -LiteralPath $stagedFiles -Destination $target -ErrorAction Stop
        foreach ($file in $files) {
            $saved = Join-Path $target $file.relative
            if (!(Test-Path -LiteralPath $saved -PathType Leaf) -or
                (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash -ne $file.sha256) { throw 'External artifact copy verification failed' }
            $file['path'] = [IO.Path]::GetRelativePath($RepositoryRoot,$saved).Replace('\','/')
            $file.Remove('relative')
        }
        return [ordered]@{ status='PASS'; files=$files; transport='adb-short-path-then-powershell-move' }
    } finally {
        $cleanup = [IO.Path]::GetFullPath($stage)
        if ($cleanup -ne $stage -or !$cleanup.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Artifact staging cleanup guard' }
        if (Test-Path -LiteralPath $cleanup) { Remove-Item -LiteralPath $cleanup -Recurse -Force -ErrorAction Stop }
    }
}
