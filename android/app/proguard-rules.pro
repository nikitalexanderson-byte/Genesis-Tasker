-keep class ru.genesis.calendar.BrowserLauncherActivity { *; }

# The current optimizer emits invalid merged bytecode during WorkManager startup
# on API 35. Retain shrinking/obfuscation while avoiding unsafe optimization.
# Similar upstream regression: https://issuetracker.google.com/issues/551348855
-dontoptimize
