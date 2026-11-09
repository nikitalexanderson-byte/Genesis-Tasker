#!/usr/bin/env bash
set -euo pipefail

apk="${1:?APK path required}"
mapping="${2:?R8 mapping path required}"
label="${3:-native-release}"
[[ "$label" =~ ^[a-z0-9-]+$ ]] || { echo 'Invalid verification label' >&2; exit 1; }
test -s "$apk"
test -s "$mapping"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK required}}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
remote_apk="/data/local/tmp/genesis-${label}-verify.apk"
remote_dex="/data/local/tmp/genesis-${label}-verifier.dex"
trap 'adb shell rm -f "$remote_apk" "$remote_dex" >/dev/null 2>&1 || true; rm -rf -- "$work"' EXIT
mkdir -p "$work/classes" "$work/dex"
platform="$(find "$sdk/platforms" -name android.jar | sort -V | tail -1)"
build_tools="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
javac --release 17 -cp "$platform" -d "$work/classes" "$root/scripts/android/GenesisDexVerifier.java"
"$build_tools/d8" --lib "$platform" --min-api 26 --output "$work/dex" "$work/classes/GenesisDexVerifier.class"

classes=()
# Verify the released C/G/B/E/F surfaces and their journal/protocol holders on ART.
sources=(
  ru.genesis.calendar.ui.GenesisAppKt
  ru.genesis.calendar.ui.SharedProjectsScreenKt
  ru.genesis.calendar.ui.ProjectsScreenKt
  ru.genesis.calendar.ui.CalendarScreenKt
  ru.genesis.calendar.ui.HabitsScreenKt
  ru.genesis.calendar.ui.HabitMeasurementControlsKt
  ru.genesis.calendar.ui.TodayHabitsContentKt
  ru.genesis.calendar.ui.SharedAutomationEditorScreenKt
  ru.genesis.calendar.ui.SharedAutomationEditorState
  ru.genesis.calendar.ui.SharedAutomationEditorFieldsKt
  ru.genesis.calendar.ui.SharedAutomationEditorEffectsKt
  ru.genesis.calendar.ui.SharedAutomationEditorScheduleKt
  ru.genesis.calendar.ui.SharedAutomationTemplateConfigurationKt
  ru.genesis.calendar.ui.SharedAutomationEditorEdits
  ru.genesis.calendar.auth.SharedAutomationEditorService
  ru.genesis.calendar.auth.SharedAutomationEditorProtocol
  ru.genesis.calendar.ui.SharedAutomationsScreenKt
  ru.genesis.calendar.ui.SharedAutomationsState
  ru.genesis.calendar.ui.SharedAutomationTemplateInspection
  ru.genesis.calendar.auth.SharedAutomationDraftService
  ru.genesis.calendar.auth.SharedAutomationProtocol
  ru.genesis.calendar.ui.SharedTemplatesScreenKt
  ru.genesis.calendar.ui.SharedTemplateControlsKt
  ru.genesis.calendar.ui.SharedTemplateApplyKt
  ru.genesis.calendar.ui.SharedFieldsScreenKt
  ru.genesis.calendar.ui.SharedFieldEditorState
  ru.genesis.calendar.auth.CustomFieldEditorProtocol
  ru.genesis.calendar.auth.CustomFieldEditorJournalContract
  ru.genesis.calendar.auth.SharedFieldEditorService
  ru.genesis.calendar.ui.SharedAutomationNavigationKt
  ru.genesis.calendar.ui.SharedTaskFieldQueryKt
  ru.genesis.calendar.ui.SharedTaskListReaderKt
  ru.genesis.calendar.ui.SharedTaskListReader
  ru.genesis.calendar.ui.SharedTaskListContext
  ru.genesis.calendar.auth.CustomFieldQueryProtocol
  ru.genesis.calendar.ui.AffairsComponentsKt
  ru.genesis.calendar.ui.ThemeSurfacesKt
  ru.genesis.calendar.ui.StoicheionRestorationScreenKt
  ru.genesis.calendar.data.StoicheionRestorationCodec
  ru.genesis.calendar.domain.StoicheionRestoration
  ru.genesis.calendar.domain.StoicheionRestorationCatalogSource
  ru.genesis.calendar.ui.SharedSavedViewsScreenKt
  ru.genesis.calendar.ui.SharedSavedViewsState
  ru.genesis.calendar.ui.SavedViewConditionsKt
  ru.genesis.calendar.auth.SavedViewDraftService
  ru.genesis.calendar.auth.SavedViewProtocol
  ru.genesis.calendar.auth.SavedViewJournalContract
  ru.genesis.calendar.ui.SharedBulkScreenKt
  ru.genesis.calendar.ui.SharedBulkState
  ru.genesis.calendar.ui.SharedBulkFormKt
  ru.genesis.calendar.auth.SharedBulkFormData
  ru.genesis.calendar.auth.SharedBulkInputContract
  ru.genesis.calendar.auth.SharedBulkProtocol
  ru.genesis.calendar.auth.SharedBulkJournalContract
  ru.genesis.calendar.auth.SharedBulkDraftService
  ru.genesis.calendar.auth.SharedBulkScopePages
  ru.genesis.calendar.auth.CustomFieldProtocol
  ru.genesis.calendar.auth.CustomFieldDefinitionProtocol
  ru.genesis.calendar.auth.SharedTemplateManifest
  ru.genesis.calendar.auth.DataImportPreview
  ru.genesis.calendar.ui.HabitLifecycleControlsKt
  ru.genesis.calendar.ui.HabitBackupPanelKt
  ru.genesis.calendar.ui.HabitAnalysisPanelKt
  ru.genesis.calendar.ui.HabitHistoryPanelKt
  ru.genesis.calendar.data.HabitBackupService
  ru.genesis.calendar.data.HabitBackups
  ru.genesis.calendar.data.HabitBackupRestore
  ru.genesis.calendar.domain.habits.HabitAnalysis
  ru.genesis.calendar.domain.habits.HabitLifecycle
  ru.genesis.calendar.auth.WorkspaceConflictPanelKt
  ru.genesis.calendar.auth.WorkspaceConflictPreview
  ru.genesis.calendar.auth.WorkspaceConflictField
)
for source in "${sources[@]}"; do
  renamed="$(awk -v source="$source" '$1 == source && $2 == "->" { sub(/:$/, "", $3); print $3 }' "$mapping")"
  [[ "$renamed" =~ ^[A-Za-z_][A-Za-z0-9_.]*$ ]] || { echo "Missing release screen mapping: $source" >&2; exit 1; }
  classes+=("$renamed")
done
adb push "$apk" "$remote_apk" >/dev/null
adb push "$work/dex/classes.dex" "$remote_dex" >/dev/null
adb shell "CLASSPATH=$remote_dex app_process /system/bin GenesisDexVerifier $remote_apk ${classes[*]}"
