package com.vapps.expensetracker;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "SmsIngest",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.RECEIVE_SMS }
        )
    }
)
public class SmsIngestPlugin extends Plugin {
    private static final String PREF_NAME = "sms_ingest_preferences";
    private static final String KEY_ENABLED = "enabled";

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        requestPermissionForAlias("sms", call, "permissionsCallback");
    }

    @PluginMethod
    public void checkSmsPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        result.put("sms", granted ? PermissionState.GRANTED.toString() : PermissionState.PROMPT.toString());
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        setSmsIngestEnabled(getContext(), enabled);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void getEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", isSmsIngestEnabled(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        result.put("enabled", isSmsIngestEnabled(getContext()));
        result.put("permissionGranted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Context context = getContext();
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", context.getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open app settings", e);
        }
    }

    @SuppressWarnings("unused")
    private void permissionsCallback(PluginCall call) {
        if (call == null) return;
        JSObject result = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        result.put("sms", granted ? PermissionState.GRANTED.toString() : PermissionState.DENIED.toString());
        call.resolve(result);
    }

    public static boolean isSmsIngestEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    public static void setSmsIngestEnabled(Context context, boolean enabled) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
    }
}

