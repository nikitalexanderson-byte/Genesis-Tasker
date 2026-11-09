package ru.genesis.calendar;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

import java.util.List;

/**
 * Opens the live GENESIS site in the device browser's Custom Tab. This avoids
 * vendor-specific blank screens in TWA/WebView implementations while keeping
 * browser cookies, Google OAuth, microphone permissions and PWA storage intact.
 */
public final class BrowserLauncherActivity extends Activity {
    private static final String TAG = "GenesisLauncher";
    private static final int GENESIS_NIGHT = Color.rgb(12, 28, 30);
    private boolean launchAttempted;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) {
            openGenesis();
        } else {
            finish();
        }
    }

    private void openGenesis() {
        if (launchAttempted) {
            return;
        }
        launchAttempted = true;

        Uri launchUri = Uri.parse(getString(R.string.launch_url));
        try {
            String customTabsProvider = CustomTabsClient.getPackageName(this, null);
            if (customTabsProvider != null) {
                CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                    .setToolbarColor(GENESIS_NIGHT)
                    .setNavigationBarColor(GENESIS_NIGHT)
                    .setNavigationBarDividerColor(GENESIS_NIGHT)
                    .build();
                CustomTabsIntent customTab = new CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(colors)
                    .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                    .setShowTitle(false)
                    .setUrlBarHidingEnabled(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                    .build();
                customTab.intent.setPackage(customTabsProvider);
                customTab.launchUrl(this, launchUri);
                finish();
                return;
            }
        } catch (RuntimeException launchError) {
            Log.w(TAG, "Custom Tab unavailable; opening an external browser", launchError);
        }

        if (openDefaultBrowser(launchUri)) {
            finish();
        } else {
            showLaunchError(launchUri);
        }
    }

    private boolean openDefaultBrowser(Uri launchUri) {
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, launchUri);
        browserIntent.addCategory(Intent.CATEGORY_BROWSABLE);
        List<ResolveInfo> candidates;
        try {
            candidates = getPackageManager().queryIntentActivities(
                browserIntent,
                PackageManager.MATCH_DEFAULT_ONLY
            );
        } catch (RuntimeException queryError) {
            Log.e(TAG, "Could not find an external browser", queryError);
            return false;
        }
        for (ResolveInfo candidate : candidates) {
            if (candidate.activityInfo == null) {
                continue;
            }
            String packageName = candidate.activityInfo.packageName;
            if (getPackageName().equals(packageName)) {
                continue;
            }
            try {
                browserIntent.setPackage(packageName);
                startActivity(browserIntent);
                return true;
            } catch (RuntimeException browserError) {
                Log.w(TAG, "Browser package could not open GENESIS: " + packageName, browserError);
            }
        }
        Log.e(TAG, "No external browser can open GENESIS");
        return false;
    }

    private void showLaunchError(Uri launchUri) {
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(padding, padding, padding, padding);
        content.setBackgroundColor(GENESIS_NIGHT);

        TextView message = new TextView(this);
        message.setText(R.string.browser_error_message);
        message.setTextColor(Color.WHITE);
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);

        Button retry = new Button(this);
        retry.setText(R.string.browser_retry);
        retry.setOnClickListener(view -> {
            if (openDefaultBrowser(launchUri)) {
                finish();
            }
        });

        content.addView(message, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        LinearLayout.LayoutParams buttonLayout = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        buttonLayout.topMargin = padding;
        content.addView(retry, buttonLayout);
        setContentView(content);
    }
}
