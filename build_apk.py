"""
GeoPlan Android - Standalone APK Builder Pipeline
Compiles and signs the native Android APK using ecj, d8/r8, aapt2, and uber-apk-signer.
"""

import os
import shutil
import subprocess
import zipfile
import struct
import zlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(BASE_DIR, 'build_android')
TOOLS_DIR = os.path.join(BASE_DIR, 'tools', 'android')

ANDROID_JAR = os.path.join(TOOLS_DIR, 'android.jar')
ECJ_JAR = os.path.join(TOOLS_DIR, 'ecj.jar')
R8_JAR = os.path.join(TOOLS_DIR, 'r8.jar')
AAPT2_EXE = os.path.join(TOOLS_DIR, 'aapt2.exe')
SIGNER_JAR = os.path.join(TOOLS_DIR, 'uber-apk-signer.jar')

JAVA_EXE = os.path.join(TOOLS_DIR, 'jre17_temp', 'jdk-17.0.10+7-jre', 'bin', 'java.exe')
if not os.path.exists(JAVA_EXE):
    JAVA_EXE = 'java'

APP_NAME = 'Geowill'
OUTPUT_APK_NAME = 'Geowill_Android_v1.0.apk'

def setup_directories():
    print('[1/6] Preparando estructura de directorios...')
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(os.path.join(BUILD_DIR, 'src', 'com', 'geowill', 'gis'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'values'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'drawable'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'xml'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-mdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-hdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xxhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xxxhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'assets'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'compiled_res'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'classes'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'dex'), exist_ok=True)

def create_manifest_and_resources():
    print('[2/6] Generando AndroidManifest.xml y recursos de Geowill...')
    
    # AndroidManifest.xml
    manifest_content = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.geowill.gis"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="33" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.BLUETOOTH" />

    <uses-feature android:name="android.hardware.location.gps" android:required="true" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true">
        
        <activity
            android:name=".MainActivity"
            android:label="@string/app_name"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".GeowillTrackingService"
            android:foregroundServiceType="location"
            android:exported="false" />

        <provider
            android:name=".GeowillFileProvider"
            android:authorities="com.geowill.gis.fileprovider"
            android:exported="true"
            android:grantUriPermissions="true" />
    </application>
</manifest>
"""
    with open(os.path.join(BUILD_DIR, 'AndroidManifest.xml'), 'w', encoding='utf-8') as f:
        f.write(manifest_content)

    # strings.xml
    strings_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Geowill</string>
</resources>
"""
    with open(os.path.join(BUILD_DIR, 'res', 'values', 'strings.xml'), 'w', encoding='utf-8') as f:
        f.write(strings_content)

    # Copy Icons from generated assets
    icon_src_512 = os.path.join(BASE_DIR, 'assets', 'icon-512.png')
    icon_src_192 = os.path.join(BASE_DIR, 'assets', 'icon-192.png')
    src_to_use = icon_src_512 if os.path.exists(icon_src_512) else icon_src_192
    if os.path.exists(src_to_use):
        for density in ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']:
            dest_dir = os.path.join(BUILD_DIR, 'res', density)
            os.makedirs(dest_dir, exist_ok=True)
            shutil.copy(src_to_use, os.path.join(dest_dir, 'ic_launcher.png'))
            shutil.copy(src_to_use, os.path.join(dest_dir, 'ic_launcher_round.png'))

def create_java_source():
    print('[3/6] Creando código Java nativo (Geowill WebView, FileProvider, Cámara y Compartir KML)...')
    
    # 1. GeowillFileProvider.java
    provider_content = """package com.geowill.gis;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public class GeowillFileProvider extends ContentProvider {
    public static final String AUTHORITY = "com.geowill.gis.fileprovider";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        int pMode = ParcelFileDescriptor.MODE_READ_ONLY;
        if (mode != null && (mode.contains("w") || mode.contains("rw") || mode.contains("wa"))) {
            pMode = ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE;
        }

        File cacheDir = getContext().getExternalCacheDir();
        if (cacheDir == null) cacheDir = getContext().getCacheDir();
        File file = new File(cacheDir, uri.getLastPathSegment());

        if (pMode != ParcelFileDescriptor.MODE_READ_ONLY || file.exists()) {
            return ParcelFileDescriptor.open(file, pMode);
        }

        File intFile = new File(getContext().getCacheDir(), uri.getLastPathSegment());
        if (intFile.exists()) {
            return ParcelFileDescriptor.open(intFile, pMode);
        }

        throw new FileNotFoundException("File not found: " + uri.getPath());
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        File file = new File(getContext().getExternalCacheDir(), uri.getLastPathSegment());
        if (!file.exists()) {
            file = new File(getContext().getCacheDir(), uri.getLastPathSegment());
        }
        if (file.exists()) {
            cursor.addRow(new Object[]{file.getName(), file.length()});
        }
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        String path = uri.getPath();
        if (path != null && path.endsWith(".kml")) {
            return "application/vnd.google-earth.kml+xml";
        }
        if (path != null && (path.endsWith(".jpg") || path.endsWith(".jpeg"))) {
            return "image/jpeg";
        }
        return "*/*";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
"""
    provider_path = os.path.join(BUILD_DIR, 'src', 'com', 'geowill', 'gis', 'GeowillFileProvider.java')
    with open(provider_path, 'w', encoding='utf-8') as f:
        f.write(provider_content)

    # 2. GeowillTrackingService.java (Background GPS & WakeLock Foreground Service)
    service_content = r"""package com.geowill.gis;

import android.app.Service;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class GeowillTrackingService extends Service implements LocationListener {
    public static final String CHANNEL_ID = "geowill_gps_channel";
    public static final int NOTIFICATION_ID = 2002;
    private static final String TAG = "GeowillGpsService";

    public static volatile boolean isRunning = false;
    public static volatile boolean isPaused = false;
    public static volatile float minDistanceThreshold = 5.0f;
    public static volatile float maxAccuracyThreshold = 15.0f;
    public static final List<String> recordedPoints = Collections.synchronizedList(new ArrayList<String>());
    public static volatile double totalDistanceMeters = 0.0;
    private static Location lastRecordedLocation = null;

    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;

    public static String getPointsJsonAndClear() {
        synchronized (recordedPoints) {
            StringBuilder sb = new StringBuilder();
            sb.append("[");
            for (int i = 0; i < recordedPoints.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(recordedPoints.get(i));
            }
            sb.append("]");
            recordedPoints.clear();
            return sb.toString();
        }
    }

    public static void clearRecordedPoints() {
        synchronized (recordedPoints) {
            recordedPoints.clear();
            totalDistanceMeters = 0.0;
            lastRecordedLocation = null;
            isPaused = false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        isRunning = true;

        try {
            createNotificationChannel();
            Notification notif = createNotification("Grabando recorrido GPS con pantalla bloqueada");
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    startForeground(NOTIFICATION_ID, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                } catch (Throwable t) {
                    startForeground(NOTIFICATION_ID, notif);
                }
            } else {
                startForeground(NOTIFICATION_ID, notif);
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error startForeground: " + t.getMessage());
        }

        // Acquire WakeLock so CPU never sleeps when screen is locked
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Geowill:GpsTrackingWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(24 * 60 * 60 * 1000L);
            }
        } catch (Throwable t) {
            Log.e(TAG, "WakeLock error: " + t.getMessage());
        }

        // Request Location updates from GPS and Network
        try {
            locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (locationManager != null) {
                if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 1.0f, this);
                }
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000, 2.0f, this);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "Location listener error: " + t.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        try {
            Notification notif = createNotification("Grabando recorrido GPS con pantalla bloqueada...");
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    startForeground(NOTIFICATION_ID, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                } catch (Throwable t) {
                    startForeground(NOTIFICATION_ID, notif);
                }
            } else {
                startForeground(NOTIFICATION_ID, notif);
            }
        } catch (Throwable t) {}
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        try {
            if (locationManager != null) {
                locationManager.removeUpdates(this);
            }
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            stopForeground(true);
        } catch (Throwable t) {
            Log.e(TAG, "onDestroy error: " + t.getMessage());
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onLocationChanged(Location loc) {
        if (loc == null || isPaused) return;

        try {
            // 1. Accuracy Filter: discard low-precision fixes (accuracy > 15m)
            if (loc.hasAccuracy() && loc.getAccuracy() > maxAccuracyThreshold) {
                return;
            }

            double lat = loc.getLatitude();
            double lng = loc.getLongitude();
            double alt = loc.getAltitude();
            float speed = loc.hasSpeed() ? loc.getSpeed() * 3.6f : 0.0f;
            float accuracy = loc.getAccuracy();
            long timestamp = loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis();

            // 2. Minimum Movement Filter (Default 5.0 meters)
            if (lastRecordedLocation != null) {
                float dist = lastRecordedLocation.distanceTo(loc);
                if (dist < minDistanceThreshold) {
                    return; // Ignore jitter under 5 meters
                }

                // 3. Outlier check: ignore impossible satellite jumps (> 40m in < 3s)
                long timeDeltaMs = loc.getTime() - lastRecordedLocation.getTime();
                if (timeDeltaMs > 0 && timeDeltaMs < 3000 && dist > 40.0f && (!loc.hasSpeed() || loc.getSpeed() < 10.0f)) {
                    return; // Glitch outlier jump discarded
                }

                totalDistanceMeters += dist;
            }
            lastRecordedLocation = loc;

            String ptJson = String.format(Locale.US,
                "{\"lat\":%.7f,\"lng\":%.7f,\"altitude\":%.1f,\"speed\":%.1f,\"accuracy\":%.1f,\"timestamp\":%d}",
                lat, lng, alt, speed, accuracy, timestamp
            );
            recordedPoints.add(ptJson);

            // Update notification
            String distStr = totalDistanceMeters > 1000
                ? String.format(Locale.US, "%.2f km", totalDistanceMeters / 1000.0)
                : String.format(Locale.US, "%.0f m", totalDistanceMeters);
            updateNotificationText(String.format(Locale.US, "Distancia: %s | Puntos: %d | Vel: %.1f km/h", distStr, recordedPoints.size(), speed));

            // Also dispatch live update to MainActivity if active
            MainActivity.dispatchNativeGpsPoint(lat, lng, alt, speed, accuracy, timestamp);
        } catch (Throwable t) {
            Log.e(TAG, "onLocationChanged error: " + t.getMessage());
        }
    }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Geowill Grabación GPS",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Mantiene el registro de trayectoria activo cuando la pantalla está bloqueada");
                channel.setShowBadge(false);
                channel.setSound(null, null);
                channel.enableVibration(false);
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            } catch (Throwable t) {}
        }
    }

    private Notification createNotification(String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("Geowill - Grabando Ruta GPS")
               .setContentText(text)
               .setSmallIcon(android.R.drawable.ic_menu_mylocation)
               .setContentIntent(pendingIntent)
               .setOngoing(true);

        return builder.build();
    }

    private void updateNotificationText(String text) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, createNotification(text));
            }
        } catch (Throwable t) {}
    }
}
"""
    service_path = os.path.join(BUILD_DIR, 'src', 'com', 'geowill', 'gis', 'GeowillTrackingService.java')
    with open(service_path, 'w', encoding='utf-8') as f:
        f.write(service_content)

    # 3. MainActivity.java
    java_content = r"""package com.geowill.gis;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.net.Uri;
import android.content.Intent;
import android.content.Context;
import android.provider.MediaStore;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.Manifest;
import android.os.Build;
import android.os.Environment;
import android.os.StrictMode;
import android.view.Window;
import android.view.WindowManager;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;

public class MainActivity extends Activity {
    public static MainActivity instance;
    private WebView webView;
    private ValueCallback<Uri[]> uploadMessageAboveL;
    private String cameraPhotoPath;
    private Uri cameraContentUri;
    private final static int FILE_CHOOSER_RESULT_CODE = 10001;
    private final static int PERMISSION_REQUEST_CODE = 20001;
    private final static int NATIVE_CAMERA_REQUEST_CODE = 20002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        // Catch any unhandled exceptions to prevent crash dialogs
        try {
            Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
                @Override
                public void uncaughtException(Thread thread, Throwable throwable) {
                    Log.e("Geowill", "Exception caught: " + throwable.getMessage(), throwable);
                }
            });
        } catch (Throwable t) {}

        // Disable file exposure strict mode to allow file URI passing
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                java.lang.reflect.Method m = StrictMode.class.getMethod("disableDeathOnFileUriExposure");
                m.invoke(null);
            } catch (Exception e) {
                StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().build());
            }
        }

        // Fullscreen
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Native bridge for WhatsApp / Bluetooth / System Sharing, Direct Camera & Background Tracking
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidNative");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams fileChooserParams) {
                if (uploadMessageAboveL != null) {
                    uploadMessageAboveL.onReceiveValue(null);
                }
                uploadMessageAboveL = filePathCallback;

                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                boolean isPdfOnly = false;
                boolean isKmlOnly = false;
                boolean isImageOnly = false;

                if (acceptTypes != null) {
                    for (String t : acceptTypes) {
                        if (t != null) {
                            String lower = t.toLowerCase();
                            if (lower.contains("pdf")) {
                                isPdfOnly = true;
                                break;
                            } else if (lower.contains("kml") || lower.contains("kmz") || lower.contains("google-earth")) {
                                isKmlOnly = true;
                                break;
                            } else if (lower.startsWith("image/")) {
                                isImageOnly = true;
                            }
                        }
                    }
                }

                // 1. If requesting PDF, ONLY open PDF document picker
                if (isPdfOnly) {
                    Intent pdfIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    pdfIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    pdfIntent.setType("application/pdf");
                    startActivityForResult(Intent.createChooser(pdfIntent, "Seleccionar Plano PDF"), FILE_CHOOSER_RESULT_CODE);
                    return true;
                }

                // 2. If requesting KML / KMZ, allow all documents (*/*) so Android shows .kml files
                if (isKmlOnly) {
                    Intent kmlIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    kmlIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    kmlIntent.setType("*/*");
                    String[] mimeTypes = {"application/vnd.google-earth.kml+xml", "application/vnd.google-earth.kmz", "text/xml", "application/xml", "application/octet-stream", "*/*"};
                    kmlIntent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
                    startActivityForResult(Intent.createChooser(kmlIntent, "Seleccionar Archivo KML"), FILE_CHOOSER_RESULT_CODE);
                    return true;
                }

                // 3. If requesting Images / Gallery
                if (isImageOnly) {
                    Intent imgIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    imgIntent.addCategory(Intent.CATEGORY_OPENABLE);
                    imgIntent.setType("image/*");
                    startActivityForResult(Intent.createChooser(imgIntent, "Seleccionar Foto"), FILE_CHOOSER_RESULT_CODE);
                    return true;
                }

                // 4. Fallback: allow all files
                Intent defaultIntent = new Intent(Intent.ACTION_GET_CONTENT);
                defaultIntent.addCategory(Intent.CATEGORY_OPENABLE);
                defaultIntent.setType("*/*");
                startActivityForResult(Intent.createChooser(defaultIntent, "Seleccionar Archivo"), FILE_CHOOSER_RESULT_CODE);
                return true;
            }
        });

        // Request runtime permissions on Android 6.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.ArrayList<String> perms = new java.util.ArrayList<String>();
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            perms.add(Manifest.permission.CAMERA);
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            if (Build.VERSION.SDK_INT >= 33) {
                perms.add("android.permission.POST_NOTIFICATIONS");
            }
            requestPermissions(perms.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }

        // Load local asset app
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.post(new Runnable() {
                @Override
                public void run() {
                    webView.evaluateJavascript("if (window.gpsTracker && window.gpsTracker.syncBufferedNativePoints) { window.gpsTracker.syncBufferedNativePoints(); }", null);
                }
            });
        }
    }

    @Override
    protected void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    public static void dispatchNativeGpsPoint(final double lat, final double lng, final double alt, final float speed, final float acc, final long timestamp) {
        if (instance != null && instance.webView != null) {
            instance.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (instance != null && instance.webView != null) {
                            String js = String.format(java.util.Locale.US,
                                "if (window.gpsTracker && window.gpsTracker.onBackgroundGpsFix) { window.gpsTracker.onBackgroundGpsFix({lat:%.7f,lng:%.7f,altitude:%.1f,speed:%.1f,accuracy:%.1f,timestamp:%d}); }",
                                lat, lng, alt, speed, acc, timestamp
                            );
                            instance.webView.evaluateJavascript(js, null);
                        }
                    } catch (Throwable t) {}
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        // 1. Handle Direct Native Camera Capture
        if (requestCode == NATIVE_CAMERA_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK) {
                Bitmap bmp = null;

                // Attempt A: Read from created file path
                if (cameraPhotoPath != null) {
                    File f = new File(cameraPhotoPath);
                    if (f.exists() && f.length() > 0) {
                        try {
                            BitmapFactory.Options options = new BitmapFactory.Options();
                            options.inSampleSize = 2; // prevent OOM
                            bmp = BitmapFactory.decodeFile(cameraPhotoPath, options);
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                }

                // Attempt B: Read from Intent Data Stream
                if (bmp == null && data != null && data.getData() != null) {
                    try {
                        InputStream is = getContentResolver().openInputStream(data.getData());
                        bmp = BitmapFactory.decodeStream(is);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                // Attempt C: Read from Content URI Stream
                if (bmp == null && cameraContentUri != null) {
                    try {
                        InputStream is = getContentResolver().openInputStream(cameraContentUri);
                        bmp = BitmapFactory.decodeStream(is);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                // Attempt D: Read from Extras thumbnail Bitmap
                if (bmp == null && data != null && data.getExtras() != null) {
                    Object obj = data.getExtras().get("data");
                    if (obj instanceof Bitmap) {
                        bmp = (Bitmap) obj;
                    }
                }

                if (bmp != null) {
                    try {
                        // Check EXIF orientation or rotate 90 degrees clockwise (a la derecha)
                        int rotate = 0;
                        if (cameraPhotoPath != null) {
                            try {
                                ExifInterface exif = new ExifInterface(cameraPhotoPath);
                                int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED);
                                if (orientation == ExifInterface.ORIENTATION_ROTATE_90) {
                                    rotate = 90;
                                } else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) {
                                    rotate = 180;
                                } else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) {
                                    rotate = 270;
                                }
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }

                        // If EXIF orientation is not present or normal, rotate 90 degrees clockwise (a la derecha)
                        if (rotate == 0) {
                            rotate = 90;
                        }

                        if (rotate != 0) {
                            Matrix matrix = new Matrix();
                            matrix.postRotate(rotate);
                            Bitmap rotatedBmp = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), matrix, true);
                            if (rotatedBmp != bmp) {
                                bmp.recycle();
                                bmp = rotatedBmp;
                            }
                        }

                        int w = bmp.getWidth();
                        int h = bmp.getHeight();
                        int max = 1280;
                        if (w > max || h > max) {
                            if (w > h) {
                                h = (h * max) / w;
                                w = max;
                            } else {
                                w = (w * max) / h;
                                h = max;
                            }
                            Bitmap scaledBmp = Bitmap.createScaledBitmap(bmp, w, h, true);
                            if (scaledBmp != bmp) {
                                bmp.recycle();
                                bmp = scaledBmp;
                            }
                        }
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.JPEG, 82, baos);
                        byte[] bytes = baos.toByteArray();
                        String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        final String dataUrl = "data:image/jpeg;base64," + base64;

                        webView.post(new Runnable() {
                            @Override
                            public void run() {
                                webView.evaluateJavascript("if (window.app && window.app.addCapturedPhoto) { window.app.addCapturedPhoto('" + dataUrl + "'); }", null);
                            }
                        });
                    } catch (Exception e) {
                        e.printStackTrace();
                        Toast.makeText(this, "Error procesando imagen: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(this, "Fotografía tomada con éxito.", Toast.LENGTH_SHORT).show();
                }
            }
            return;
        }

        // 2. Handle File / Gallery Chooser
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (uploadMessageAboveL != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
                uploadMessageAboveL.onReceiveValue(results);
                uploadMessageAboveL = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * Native Android JavascriptInterface for Direct Camera, Sharing & Safe Background GPS
     */
    public class AndroidBridge {
        private Context mContext;

        public AndroidBridge(Context context) {
            this.mContext = context;
        }

        @JavascriptInterface
        public void startBackgroundTracking() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        GeowillTrackingService.clearRecordedPoints();
                        Intent serviceIntent = new Intent(MainActivity.this, GeowillTrackingService.class);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(serviceIntent);
                        } else {
                            startService(serviceIntent);
                        }
                    } catch (Throwable e) {
                        Log.e("Geowill", "startBackgroundTracking error: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopBackgroundTracking() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent serviceIntent = new Intent(MainActivity.this, GeowillTrackingService.class);
                        stopService(serviceIntent);
                    } catch (Throwable e) {
                        Log.e("Geowill", "stopBackgroundTracking error: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void pauseBackgroundTracking() {
            GeowillTrackingService.isPaused = true;
        }

        @JavascriptInterface
        public void resumeBackgroundTracking() {
            GeowillTrackingService.isPaused = false;
        }

        @JavascriptInterface
        public boolean isBackgroundTrackingPaused() {
            return GeowillTrackingService.isPaused;
        }

        @JavascriptInterface
        public void setMinDistanceFilter(float meters) {
            GeowillTrackingService.minDistanceThreshold = meters > 0 ? meters : 5.0f;
        }

        @JavascriptInterface
        public String getBufferedTrackPoints() {
            return GeowillTrackingService.getPointsJsonAndClear();
        }

        @JavascriptInterface
        public boolean isBackgroundTrackingRunning() {
            return GeowillTrackingService.isRunning;
        }

        @JavascriptInterface
        public void takeCameraPhoto() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        File storageDir = mContext.getExternalCacheDir();
                        if (storageDir == null) storageDir = mContext.getCacheDir();
                        File photoFile = new File(storageDir, "FOTO_CAM_" + System.currentTimeMillis() + ".jpg");
                        cameraPhotoPath = photoFile.getAbsolutePath();
                        cameraContentUri = Uri.parse("content://" + GeowillFileProvider.AUTHORITY + "/" + photoFile.getName());

                        Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraContentUri);
                        takePictureIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        startActivityForResult(takePictureIntent, NATIVE_CAMERA_REQUEST_CODE);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Error al abrir cámara: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void shareKmlFile(final String fileName, final String kmlText, final String subject) {
            shareKmlInternal(fileName, kmlText, subject);
        }

        @JavascriptInterface
        public void shareKml(final String kmlText, final String fileName) {
            shareKmlInternal(fileName, kmlText, null);
        }

        private void shareKmlInternal(final String fileName, final String kmlText, final String subject) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String validName = (fileName != null && !fileName.trim().isEmpty()) ? fileName.trim() : "levantamiento.kml";
                        if (!validName.toLowerCase().endsWith(".kml")) {
                            validName += ".kml";
                        }

                        // Write to external cache dir (preferred for sharing) and internal cache fallback
                        File dir = mContext.getExternalCacheDir();
                        if (dir == null) dir = mContext.getCacheDir();
                        if (!dir.exists()) dir.mkdirs();

                        File file = new File(dir, validName);
                        FileOutputStream fos = new FileOutputStream(file);
                        fos.write(kmlText.getBytes("UTF-8"));
                        fos.flush();
                        fos.close();

                        // Also write copy to internal cache to ensure FileProvider can find it either way
                        try {
                            File intDir = mContext.getCacheDir();
                            if (intDir != null && !intDir.equals(dir)) {
                                File intFile = new File(intDir, validName);
                                FileOutputStream intFos = new FileOutputStream(intFile);
                                intFos.write(kmlText.getBytes("UTF-8"));
                                intFos.flush();
                                intFos.close();
                            }
                        } catch (Exception ignored) {}

                        Uri contentUri = Uri.parse("content://" + GeowillFileProvider.AUTHORITY + "/" + validName);

                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("application/vnd.google-earth.kml+xml");
                        sendIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                        sendIntent.putExtra(Intent.EXTRA_SUBJECT, subject != null ? subject : validName.replace(".kml", ""));
                        sendIntent.putExtra(Intent.EXTRA_TEXT, "Levantamiento topográfico Geowill: " + (subject != null ? subject : validName));
                        sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        // Grant read permission to all matching apps
                        java.util.List<android.content.pm.ResolveInfo> resInfoList = mContext.getPackageManager().queryIntentActivities(sendIntent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
                        for (android.content.pm.ResolveInfo resolveInfo : resInfoList) {
                            String packageName = resolveInfo.activityInfo.packageName;
                            mContext.grantUriPermission(packageName, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        }

                        Intent chooser = Intent.createChooser(sendIntent, "Enviar KML por WhatsApp, Bluetooth, etc.");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        MainActivity.this.startActivity(chooser);
                    } catch (Exception e) {
                        e.printStackTrace();
                        Toast.makeText(MainActivity.this, "Error al compartir KML: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void showToast(String message) {
            Toast.makeText(mContext, message, Toast.LENGTH_SHORT).show();
        }
    }
}
"""
    java_path = os.path.join(BUILD_DIR, 'src', 'com', 'geowill', 'gis', 'MainActivity.java')
    with open(java_path, 'w', encoding='utf-8') as f:
        f.write(java_content)

def copy_web_assets():
    print('[4/6] Copiando recursos web (HTML, CSS, JS, Libs) al paquete APK...')
    assets_dest = os.path.join(BUILD_DIR, 'assets')
    
    # Files to copy
    files = ['index.html', 'manifest.json', 'sw.js']
    for file in files:
        src = os.path.join(BASE_DIR, file)
        if os.path.exists(src):
            shutil.copy(src, assets_dest)

    # Directories to copy
    dirs = ['css', 'js', 'assets']
    for d in dirs:
        src = os.path.join(BASE_DIR, d)
        dst = os.path.join(assets_dest, d)
        if os.path.exists(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)

def compile_and_package():
    print('[5/6] Compilando recursos con aapt2 y código Java...')

    # 1. aapt2 compile resources
    res_dir = os.path.join(BUILD_DIR, 'res')
    compiled_res_zip = os.path.join(BUILD_DIR, 'compiled_res', 'resources.zip')
    cmd = [AAPT2_EXE, 'compile', '--dir', res_dir, '-o', compiled_res_zip]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error aapt2 compile:', res.stderr)
        raise RuntimeError(res.stderr)

    # 2. aapt2 link to generate R.java and initial unsigned APK package
    unaligned_apk = os.path.join(BUILD_DIR, 'unaligned.apk')
    r_java_dir = os.path.join(BUILD_DIR, 'src')
    manifest_file = os.path.join(BUILD_DIR, 'AndroidManifest.xml')
    assets_dir = os.path.join(BUILD_DIR, 'assets')

    cmd = [
        AAPT2_EXE, 'link',
        '-I', ANDROID_JAR,
        '--manifest', manifest_file,
        '--java', r_java_dir,
        '-A', assets_dir,
        '-o', unaligned_apk,
        compiled_res_zip,
        '--auto-add-overlay'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error aapt2 link:', res.stderr)
        raise RuntimeError(res.stderr)

    # 3. Compile Java with ecj.jar
    print('Compilando Java a bytecode (.class)...')
    classes_dir = os.path.join(BUILD_DIR, 'classes')
    java_files = []
    for root, _, files in os.walk(os.path.join(BUILD_DIR, 'src')):
        for file in files:
            if file.endswith('.java'):
                java_files.append(os.path.join(root, file))

    cmd = [
        JAVA_EXE, '-jar', ECJ_JAR,
        '-7',
        '-cp', ANDROID_JAR,
        '-d', classes_dir,
        *java_files
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 and not os.path.exists(os.path.join(classes_dir, 'com', 'geowill', 'gis', 'MainActivity.class')):
        print('Error ecj:', res.stderr)
        raise RuntimeError(res.stderr)

    # 4. Convert .class to classes.dex using D8/R8
    print('Convirtiendo bytecode a Dalvik Executable (classes.dex)...')
    dex_dir = os.path.join(BUILD_DIR, 'dex')
    class_files = []
    for root, _, files in os.walk(classes_dir):
        for file in files:
            if file.endswith('.class'):
                class_files.append(os.path.join(root, file))

    cmd = [
        JAVA_EXE, '-cp', R8_JAR,
        'com.android.tools.r8.D8',
        '--lib', ANDROID_JAR,
        '--min-api', '21',
        '--output', dex_dir,
        *class_files
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error d8:', res.stderr)
        raise RuntimeError(res.stderr)

    # 5. Add classes.dex into unaligned.apk
    print('Incrustando classes.dex en el paquete APK...')
    dex_file = os.path.join(dex_dir, 'classes.dex')
    with zipfile.ZipFile(unaligned_apk, 'a') as apk_zip:
        apk_zip.write(dex_file, 'classes.dex')

def sign_apk():
    print('[6/6] Firmando el paquete APK con certificado compatible con Android...')
    unaligned_apk = os.path.join(BUILD_DIR, 'unaligned.apk')
    output_dir = BASE_DIR

    # Sign with uber-apk-signer (V1 + V2 + V3 Scheme for Android 5.0 to 14+)
    cmd = [
        JAVA_EXE, '-jar', SIGNER_JAR,
        '-a', unaligned_apk,
        '-o', output_dir
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Signer warning:', res.stderr)

    # Rename signed APK to final friendly name
    signed_apk = os.path.join(BASE_DIR, 'unaligned-aligned-debugSigned.apk')
    final_apk = os.path.join(BASE_DIR, OUTPUT_APK_NAME)

    if os.path.exists(signed_apk):
        if os.path.exists(final_apk):
            os.remove(final_apk)
        os.rename(signed_apk, final_apk)
        print(f'\n=============================================================')
        print(f' EXITOSO: APK GENERADO LISTO PARA INSTALAR O ENVIAR')
        print(f' Archivo: {final_apk}')
        print(f' Tamano: {os.path.getsize(final_apk) / 1024:.1f} KB')
        print(f'=============================================================\n')
        return final_apk
    else:
        raise RuntimeError('No se encontró el APK firmado.')

if __name__ == '__main__':
    setup_directories()
    create_manifest_and_resources()
    create_java_source()
    copy_web_assets()
    compile_and_package()
    final_path = sign_apk()
