param(
    [string]$BaseRef = 'HEAD',
    [string]$JdkHome = 'C:/Program Files/Android/Android Studio/jbr',
    [string]$GradleCacheRoot = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1')
)
$ErrorActionPreference = 'Stop'
$androidProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$androidJava = Join-Path $JdkHome 'bin/java.exe'
if (-not (Test-Path -LiteralPath $androidJava)) { throw 'A JDK with Java source-file support is required.' }
$androidKotlinCache = Join-Path $GradleCacheRoot 'org.jetbrains.kotlin'
$androidParserJars = @(Get-ChildItem -LiteralPath $androidKotlinCache -Recurse -Filter '*.jar' |
    Where-Object { $_.FullName -match '[\\/](kotlin-compiler-embeddable|kotlin-stdlib|kotlin-script-runtime|kotlin-reflect)[\\/]' } |
    ForEach-Object FullName)
foreach ($androidDependency in @('org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm', 'org.jetbrains.intellij.deps/trove4j')) {
    $androidDependencyRoot = Join-Path $GradleCacheRoot $androidDependency
    if (Test-Path -LiteralPath $androidDependencyRoot) {
        $androidParserJars += @(Get-ChildItem -LiteralPath $androidDependencyRoot -Recurse -Filter '*.jar' | ForEach-Object FullName)
    }
}
if (-not ($androidParserJars | Where-Object { $_ -match 'kotlin-compiler-embeddable' })) {
    throw 'Kotlin PSI is not cached. No Gradle or Android build will be started by this script.'
}
Push-Location $androidProjectRoot
try {
    $androidSources = @(& git -c core.safecrlf=false -c core.quotepath=false diff --name-only $BaseRef -- '*.kt' '*.kts')
    if ($LASTEXITCODE -ne 0) { throw 'Could not read changed Kotlin paths.' }
    $androidSources += @(& git -c core.quotepath=false ls-files --others --exclude-standard -- '*.kt' '*.kts')
    if ($LASTEXITCODE -ne 0) { throw 'Could not read untracked Kotlin paths.' }
    $androidSources = @($androidSources | Sort-Object -Unique)
    if ($androidSources.Count -eq 0) { Write-Output 'No changed Kotlin sources to parse.'; exit 0 }
    & $androidJava -cp ($androidParserJars -join [IO.Path]::PathSeparator) (Join-Path $PSScriptRoot 'CheckKotlinSyntax.java') @androidSources
    $androidParserExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $androidParserExitCode
