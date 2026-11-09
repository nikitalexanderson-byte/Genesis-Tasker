param([string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path)
$ErrorActionPreference = 'Stop'
. (Join-Path $RepositoryRoot 'scripts/qa/android-common.ps1')
$cases = @(
    @{ name = 'unlocked'; policy = "  showing=false`r`n  inputRestricted=false`r`n"; expected = 'CLEAR' },
    @{ name = 'lockscreen'; policy = "showing=true`ninputRestricted=true"; expected = 'LOCKED' },
    @{ name = 'occluded-lockscreen'; policy = "showing=true`ninputRestricted=false`nmCurrentFocus=application"; expected = 'LOCKED' },
    @{ name = 'restricted'; policy = "showing=false`ninputRestricted=true"; expected = 'LOCKED' },
    @{ name = 'missing-showing'; policy = 'inputRestricted=false'; expected = 'UNKNOWN' },
    @{ name = 'missing-restricted'; policy = 'showing=false'; expected = 'UNKNOWN' },
    @{ name = 'unrelated-fields'; policy = "mIsShowing=false`nmInputRestricted=false"; expected = 'UNKNOWN' }
)
foreach ($case in $cases) {
    $actual = Convert-NativeKeyguardPolicy $case.policy
    if ($actual.status -ne $case.expected) { throw "Keyguard classification failed: $($case.name)" }
}
[ordered]@{ status = 'PASS'; checks = $cases.Count; scope = 'Lockscreen precondition classification; no device settings or user data accessed.' } | ConvertTo-Json
