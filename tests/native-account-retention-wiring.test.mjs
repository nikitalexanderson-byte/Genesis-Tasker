import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../android/app/${path}`, import.meta.url), 'utf8');

// Source contracts only: Android/Kotlin compilation and device tests are deliberately separate.
test('native visits originate from resumed Activity callbacks and carry no client timestamp', async () => {
  const [activity, visit, transport] = await Promise.all([
    source('src/main/java/ru/genesis/calendar/MainActivity.kt'),
    source('src/main/java/ru/genesis/calendar/auth/NativeActivityVisit.kt'),
    source('src/main/java/ru/genesis/calendar/auth/AuthSessionClient.kt'),
  ]);
  assert.match(activity, /override fun onResume\(\)[\s\S]*?NativeActivityVisit\.onResume\(\)/);
  assert.match(activity, /override fun onPause\(\)[\s\S]*?NativeActivityVisit\.onPause\(\)/);
  assert.match(visit, /@Volatile private var visit: String\? = null/);
  assert.match(visit, /UUID\.randomUUID\(\)/);
  assert.doesNotMatch(visit, /currentTimeMillis|nanoTime|Instant\.now|LocalDate/);
  assert.equal((transport.match(/NativeActivityVisit\.headers\(\)/g) ?? []).length, 2);
});

test('background sync and notification reads explicitly suppress foreground headers', async () => {
  const controller = await source('src/main/java/ru/genesis/calendar/auth/AuthController.kt');
  assert.match(controller, /synchronizeInBackground\(\)[\s\S]*?NativeActivityVisit\.requestContext\(true\)/);
  assert.match(controller, /checkSession\(inBackground = true\)/);
  assert.match(controller, /syncPending\(WorkspacePatch\.ConflictPolicy\.STOP, inBackground = true\)/);
  assert.match(controller, /syncJob = scope\.launch\(NativeActivityVisit\.requestContext\(inBackground\)\)/);
  assert.match(controller, /operation = scope\.launch\(NativeActivityVisit\.requestContext\(inBackground\)\)/);
  assert.match(controller, /NativeActivityVisit\.requestContext\(surface == "phone"\)/);
});

test('account checkout has its own POST route and retains generation and account guards', async () => {
  const [transport, controller, checkout] = await Promise.all([
    source('src/main/java/ru/genesis/calendar/auth/AuthSessionClient.kt'),
    source('src/main/java/ru/genesis/calendar/auth/AuthController.kt'),
    source('src/main/java/ru/genesis/calendar/auth/DonationCheckout.kt'),
  ]);
  assert.match(transport, /path == "\/donations\/cloudtips\/checkout" && method == "POST"/);
  assert.match(transport, /fun donationCheckout\(expected: Long\): JSONObject = request\(expected, "\/donations\/cloudtips\/checkout", JSONObject\(\)\)/);
  const donation = controller.split('internal suspend fun donationUrl(): String {')[1].split('suspend fun todayAds')[0];
  assert.match(donation, /client\.donationCheckout\(generation\)/);
  assert.match(donation, /!client\.isCurrent\(generation\)/);
  assert.match(donation, /current\.user\?\.uid != uid/);
  assert.match(donation, /app\.workspaceScope != CloudAccountSnapshot\.scopeFor\(uid\)/);
  assert.match(checkout, /uri\.host == "pay\.cloudtips\.ru"/);
  assert.match(checkout, /uri\.userInfo == null && uri\.port == -1/);
});

test('native donation controls request a checkout on click and notifications only navigate in the same scope', async () => {
  const [links, notice, action, notification, app] = await Promise.all([
    source('src/main/java/ru/genesis/calendar/auth/AuthPanel.kt'),
    source('src/main/java/ru/genesis/calendar/ui/SupportNotice.kt'),
    source('src/main/java/ru/genesis/calendar/ui/DonationAction.kt'),
    source('src/main/java/ru/genesis/calendar/reminders/SupportTipsNotifications.kt'),
    source('src/main/java/ru/genesis/calendar/ui/GenesisApp.kt'),
  ]);
  for (const text of [links, notice]) {
    assert.match(text, /rememberDonationAction\(controller\)/);
    assert.doesNotMatch(text, /pay\.cloudtips\.ru/);
  }
  assert.match(action, /val url = controller\.donationUrl\(\)/);
  assert.doesNotMatch(action, /publicDonationUrl|pay\.cloudtips\.ru/);
  assert.doesNotMatch(notification, /donationUrl\(|donationCheckout\(|pay\.cloudtips\.ru/);
  assert.match(notification, /putExtra\("scope",scope\)/);
  assert.match(notification, /app\.workspaceScope!=scope/);
  assert.match(notification, /putExtra\("openSection","donation"\)/);
  assert.match(app, /substringBefore\('#'\) == "donation"[\s\S]*?menuSwipeState\.settings = "links"/);
});

test('the prepared native version is 3.2.9 with monotonically increasing code 141', async () => {
  const gradle = await source('build.gradle.kts');
  assert.match(gradle, /versionCode = 141/);
  assert.match(gradle, /versionName = "3\.2\.9"/);
});
