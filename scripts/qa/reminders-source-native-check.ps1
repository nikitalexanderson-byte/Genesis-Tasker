param(
    [Parameter(Mandatory)][ValidateSet('emulator-5578','emulator-5582','emulator-5590')][string]$Serial,
    [Parameter(Mandatory)][string]$RunId,
    [switch]$GuardOnly
)
$ErrorActionPreference='Stop'
$genesisRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$genesisAdb='C:/Users/mrdeu/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$ownedNames=@{'emulator-5578'='GenesisSecurity336_API34';'emulator-5582'='GenesisSecurity336_API35';'emulator-5590'='GenesisSecurity336_API26'}
$actualAvd=((& $genesisAdb -s $Serial emu avd name) | Select-Object -First 1).Trim()
if($LASTEXITCODE -ne 0 -or $actualAvd -ne $ownedNames[$Serial]){throw 'The selected serial is not the expected task-owned AVD'}
if($Serial -eq 'emulator-5590' -and !$GuardOnly){throw 'API26 provider69 is not accepted for the packaged source; choose GuardOnly'}
$sourceClass='ru.genesis.calendar.ui.RemindersMigrationSourceTest'
$classes=if($GuardOnly){@(
    "$sourceClass#lateNativeSchedulersAndPreferenceWritersCannotCrossThePersistentPreparingFence",
    "$sourceClass#alreadyAdmittedNativeReminderOperationDrainsBeforeCaptureWithoutNestedPermitDeadlock",
    "$sourceClass#accountChangesAndPreparingFencesCancelBackgroundJobsWithoutCrashingOrWriting",
    "$sourceClass#verifiedIncomingBootstrapImportsItsOwnScopeBeforeActivationAndStillHonorsThatScopesFence"
)}else{@($sourceClass,'ru.genesis.calendar.ui.PhysisMigrationSourceTest#coldNativeSourceKeepsServerRecordsAndDeletionsAfterNewEncryptionAndOldKeystoreLoss')}
$importer='ru.genesis.calendar.CloudAccountImporterTest'
$classes+=@(
    "$importer#importsOnlyAccountScopeAndRetainsPendingLocalChanges",
    "$importer#googleWarningDoesNotEraseCachedTasks",
    "$importer#firstSignInImportsNamedAndUntitledTasksIntoTheCalendarWithoutExistingCache",
    "$importer#malformedRowsDoNotBlockValidTasksOrEraseCachedTasksAndPendingChanges",
    "$importer#invalidReminderMetadataCannotRollBackOtherTasks",
    "$importer#all39TasksIncludingThreeLongAccountIdentifiersAreImportedOnFirstSignIn",
    "$importer#importedWebRemindersAreScheduledAndRefreshedWithoutLocalOutbox",
    "$importer#twoDevicesReceiveRemoteTasksWhileOneHasUnsentEdits",
    "$importer#deferredGoogleLoadOpensAccountWithoutErasingTasksAndPartialLoadAddsNewRows",
    "$importer#webAccountWithIncompleteSleepRecordsImportsAndSyncsWithoutLosingData",
    "$importer#acknowledgedDeletionSurvivesAnOlderCloudResponse",
    'ru.genesis.calendar.ReminderFlowTest#snoozeAndStaleVersionAreIdempotent',
    'ru.genesis.calendar.ReminderFlowTest#fiveRemindersPersistAndCancelTogether'
)
# The pre-existing optional redacted-server fixture is intentionally not selected.
# Source tests and all selected import/task scenarios use synthetic data only.
& (Join-Path $PSScriptRoot 'android-full.ps1') -SkipBuild -Serial @($Serial) -Class $classes -PhysicalDeviceLabel ('security336-'+$Serial.Replace('emulator-','api-port-')) -RunId $RunId
