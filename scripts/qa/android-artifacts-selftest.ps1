#requires -Version 7.4
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference='Stop'
$previousNativeExitCode=$global:LASTEXITCODE
. (Join-Path $PSScriptRoot 'android-common.ps1')
$testBoundary=[IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'output/qa'))+[IO.Path]::DirectorySeparatorChar
$testRoot=Join-Path $testBoundary ('artifact-selftest-'+[Guid]::NewGuid().ToString('N'))
$script:artifactMockMode='present'
$script:artifactMockStages=[System.Collections.Generic.List[string]]::new()
function Invoke-ArtifactMock {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    $global:LASTEXITCODE=0
    if($Arguments[2] -eq 'shell'){ $script:artifactMockMode; return }
    if($Arguments[2] -ne 'pull'){throw 'Unexpected mock operation'}
    $directory=$Arguments[4]
    $script:artifactMockStages.Add((Split-Path $directory -Parent))
    if($script:artifactMockMode -eq 'pull-failure'){$global:LASTEXITCODE=7;return}
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $directory 'proof.bin'),[byte[]](0,10,13,127,128,255))
}
$checks=[System.Collections.Generic.List[object]]::new()
try {
    $destination=Join-Path $testRoot (('long-segment-'*12)+'/artifacts')
    if($destination.Length -lt 260){throw 'The long-path selftest must exceed MAX_PATH'}
    $saved=Save-NativeExternalArtifacts 'Invoke-ArtifactMock' 'emulator-mock' 'ru.genesis.calendar.qa1103.debug' $destination $RepositoryRoot
    if($saved.status -ne 'PASS' -or $saved.files.Count -ne 1 -or
        [Convert]::ToHexString([IO.File]::ReadAllBytes((Join-Path $destination 'proof.bin'))) -ne '000A0D7F80FF'){throw 'Long-path evidence changed'}
    $checks.Add([ordered]@{id='long-path-byte-preservation';status='PASS';destinationLength=$destination.Length})
    $script:artifactMockMode='absent'
    $absent=Save-NativeExternalArtifacts 'Invoke-ArtifactMock' 'emulator-mock' 'ru.genesis.calendar.qa1103.debug' (Join-Path $testRoot 'absent') $RepositoryRoot
    if($absent.status -ne 'NOT_APPLICABLE'){throw 'Missing artifacts must be explicit'}
    $checks.Add([ordered]@{id='explicit-no-external-artifacts';status='PASS'})
    $script:artifactMockMode='pull-failure'
    function Invoke-FailedArtifactMock {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
        if($Arguments[2] -eq 'shell'){$global:LASTEXITCODE=0;'present';return}
        Invoke-ArtifactMock @Arguments
    }
    $rejected=$false
    try { Save-NativeExternalArtifacts 'Invoke-FailedArtifactMock' 'emulator-mock' 'ru.genesis.calendar.qa1103.debug' (Join-Path $testRoot 'failed') $RepositoryRoot | Out-Null }
    catch { if($_.Exception.Message -notmatch 'pull failed \(exit 7\)'){throw};$rejected=$true }
    if(!$rejected){throw 'Failed pull was hidden'}
    $checks.Add([ordered]@{id='pull-failure-is-not-silent';status='PASS'})
    $rejected=$false
    try { Save-NativeExternalArtifacts 'Invoke-ArtifactMock' 'emulator-mock' 'ru.genesis.calendar.qa1103.debug' (Join-Path $RepositoryRoot 'outside-artifacts') $RepositoryRoot | Out-Null }
    catch {if($_.Exception.Message -notmatch 'outside output/qa'){throw};$rejected=$true}
    if(!$rejected){throw 'Outside destination was accepted'}
    $checks.Add([ordered]@{id='destination-boundary';status='PASS'})
    if(@($script:artifactMockStages | Where-Object {Test-Path -LiteralPath $_}).Count){throw 'Temporary staging was not cleaned'}
    $checks.Add([ordered]@{id='staging-cleanup-after-success-and-failure';status='PASS'})
    [ordered]@{status='PASS';checks=@($checks);realAdbInvocations=0} | ConvertTo-Json -Depth 5
} finally {
    $cleanup=[IO.Path]::GetFullPath($testRoot)
    if(!$cleanup.StartsWith($testBoundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Selftest cleanup guard'}
    if(Test-Path -LiteralPath $cleanup){Remove-Item -LiteralPath $cleanup -Recurse -Force}
    $global:LASTEXITCODE=$previousNativeExitCode
}
