package com.configmancooper.aetherglyph;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.UpdateAvailability;

public class MainActivity extends BridgeActivity {
    private AppUpdateManager appUpdateManager;
    private boolean updatePromptShown;
    private boolean resumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appUpdateManager = AppUpdateManagerFactory.create(this);
        checkForPlayStoreUpdate();
    }

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        if (!updatePromptShown && appUpdateManager != null) {
            checkForPlayStoreUpdate();
        }
    }

    @Override
    public void onPause() {
        resumed = false;
        super.onPause();
    }

    private void checkForPlayStoreUpdate() {
        appUpdateManager.getAppUpdateInfo()
            .addOnSuccessListener(info -> {
                if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
                    showUpdatePrompt();
                }
            })
            .addOnFailureListener(error -> {
                // Sideloaded builds and devices without the Play Store simply
                // continue without an update prompt.
            });
    }

    private void showUpdatePrompt() {
        if (updatePromptShown || !resumed || isFinishing() || isDestroyed()) return;
        updatePromptShown = true;
        String appName = getApplicationInfo().loadLabel(getPackageManager()).toString();
        new AlertDialog.Builder(this)
            .setTitle("Update available")
            .setMessage("A newer version of " + appName + " is available on Google Play.")
            .setPositiveButton("Update", (dialog, which) -> openPlayStore())
            .setNegativeButton("Later", null)
            .show();
    }

    private void openPlayStore() {
        String packageName = getPackageName();
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                Uri.parse("market://details?id=" + packageName)));
        } catch (ActivityNotFoundException error) {
            startActivity(new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://play.google.com/store/apps/details?id=" + packageName)));
        }
    }
}
