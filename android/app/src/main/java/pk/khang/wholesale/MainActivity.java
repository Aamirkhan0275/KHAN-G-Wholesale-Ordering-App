package pk.khang.wholesale;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.net.URISyntaxException;

/**
 * KHAN G Android app: a full-screen WebView around the KHAN G web app (the same
 * responsive PWA the browser uses), so every phone, tablet and orientation gets the
 * same tested UI and updates arrive without reinstalling.
 *
 * - Pages of the configured KHAN G server open inside the app; everything else
 *   (WhatsApp click-to-chat, phone calls, other websites) opens in the right app.
 * - Invoice PDFs / CSV exports download with the signed-in session.
 * - Product photo upload uses the system picker / camera.
 * - Without internet a bilingual "no connection" screen offers Retry.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private static final int STORAGE_REQUEST = 42;
    private static final String PREFS = "khang";
    private static final String KEY_SERVER = "server_url";

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCallback;
    private PendingDownload pendingDownload;
    /** Last main-frame URL; the bridge only acts for the app's own bundled pages. */
    private volatile String currentUrl = "";

    private static class PendingDownload { String url, userAgent, disposition, mime; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F6F5"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        // Respect the phone's font-size setting (accessibility) — the web app layout is fluid.
        s.setUserAgentString(s.getUserAgentString() + " KhanGApp/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "KhanGAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> startDownload(url, userAgent, disposition, mime));

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            openHome();
        }
    }

    // ------------------------------------------------------------------ navigation
    String serverUrl() {
        String v = prefs.getString(KEY_SERVER, null);
        if (v == null || v.trim().isEmpty()) v = BuildConfig.SERVER_URL;
        return v == null ? "" : v.trim();
    }

    void openHome() {
        String url = serverUrl();
        if (url.isEmpty()) web.loadUrl("file:///android_asset/setup.html");
        else web.loadUrl(url + "/");
    }

    boolean isOwnServer(Uri u) {
        String server = serverUrl();
        if (server.isEmpty() || u == null || u.getHost() == null) return false;
        Uri s = Uri.parse(server);
        return u.getHost().equalsIgnoreCase(s.getHost())
                && u.getPort() == s.getPort()
                && ("https".equals(u.getScheme()) || ("http".equals(u.getScheme()) && "http".equals(s.getScheme())));
    }

    boolean openExternally(String url) {
        try {
            Intent intent;
            if (url.startsWith("intent:")) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            }
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | URISyntaxException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String url = u.toString();
            if (url.startsWith("file:///android_asset/")) return false;
            if (isOwnServer(u)) return false;            // KHAN G pages stay in the app
            openExternally(url);                          // wa.me, tel:, other sites → their apps
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            currentUrl = url == null ? "" : url;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isOwnServer(request.getUrl())) {
                view.loadUrl("file:///android_asset/offline.html");
            }
        }
    }

    // ------------------------------------------------------------- file upload
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------------------------------------------------------------- downloads
    void startDownload(String url, String userAgent, String disposition, String mime) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = new PendingDownload();
            pendingDownload.url = url; pendingDownload.userAgent = userAgent;
            pendingDownload.disposition = disposition; pendingDownload.mime = mime;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_REQUEST);
            return;
        }
        enqueue(url, userAgent, disposition, mime, true);
    }

    void enqueue(String url, String userAgent, String disposition, String mime, boolean publicDownloads) {
        String name = URLUtil.guessFileName(url, disposition, mime);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) req.addRequestHeader("Cookie", cookie);   // invoices are private: send the session
        req.addRequestHeader("User-Agent", userAgent);
        req.setMimeType(mime);
        req.setTitle(name);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        if (publicDownloads) req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        else req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        dm.enqueue(req);
        Toast.makeText(this, getString(R.string.downloading) + " " + name, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == STORAGE_REQUEST && pendingDownload != null) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            PendingDownload p = pendingDownload;
            pendingDownload = null;
            enqueue(p.url, p.userAgent, p.disposition, p.mime, granted);
        }
    }

    // --------------------------------------------- bridge for setup/offline pages
    private class Bridge {
        /** Returns "" when saved, or an error code. Only used by the bundled setup page. */
        @JavascriptInterface
        public String saveServerUrl(String raw) {
            if (!currentUrl.startsWith("file:///android_asset/")) return "not_allowed";
            String url = raw == null ? "" : raw.trim();
            while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
            if (!url.startsWith("https://") && !(BuildConfig.ALLOW_HTTP && url.startsWith("http://"))) return "https_required";
            Uri u = Uri.parse(url);
            if (u.getHost() == null || u.getHost().isEmpty()) return "invalid";
            prefs.edit().putString(KEY_SERVER, url).apply();
            runOnUiThread(MainActivity.this::openHome);
            return "";
        }

        @JavascriptInterface
        public String serverUrl() { return MainActivity.this.serverUrl(); }

        @JavascriptInterface
        public boolean allowHttp() { return BuildConfig.ALLOW_HTTP; }

        @JavascriptInterface
        public void retry() { runOnUiThread(MainActivity.this::openHome); }

        @JavascriptInterface
        public void openSetup() {
            if (!currentUrl.startsWith("file:///android_asset/")) return; runOnUiThread(() -> web.loadUrl("file:///android_asset/setup.html")); }
    }

    // ---------------------------------------------------------------- lifecycle
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();   // keep the 30-day sign-in
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.setVisibility(View.GONE); web.destroy(); }
        super.onDestroy();
    }
}
