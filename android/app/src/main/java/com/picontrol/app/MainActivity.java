package com.picontrol.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private LinearLayout setupLayout;
    private EditText ipInput;
    private Button connectBtn;
    private ProgressBar progressBar;
    private SharedPreferences sharedPreferences;

    private static final String PREFS_NAME = "PiControlPrefs";
    private static final String KEY_SERVER_URL = "server_url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Bind Views
        webView = findViewById(R.id.webview);
        setupLayout = findViewById(R.id.setup_layout);
        ipInput = findViewById(R.id.ip_input);
        connectBtn = findViewById(R.id.connect_btn);
        progressBar = findViewById(R.id.progress_bar);

        sharedPreferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // Setup WebView parameters
        configureWebView();

        // Connect button handler
        connectBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = ipInput.getText().toString().trim();
                if (url.isEmpty()) {
                    Toast.makeText(MainActivity.this, "Please enter a valid URL", Toast.LENGTH_SHORT).show();
                    return;
                }

                // Add protocol prefix if missing
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "http://" + url;
                }

                // Save URL and load
                sharedPreferences.edit().putString(KEY_SERVER_URL, url).apply();
                loadServerUrl(url);
            }
        });

        // Auto load saved URL if exists
        String savedUrl = sharedPreferences.getString(KEY_SERVER_URL, "");
        if (!savedUrl.isEmpty()) {
            ipInput.setText(savedUrl);
            loadServerUrl(savedUrl);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Prevent links from opening in external default browser
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                setupLayout.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Handle failures (e.g. host server is offline)
                progressBar.setVisibility(View.GONE);
                webView.setVisibility(View.GONE);
                setupLayout.setVisibility(View.VISIBLE);
                Toast.makeText(MainActivity.this, "Failed connecting to server. Is it online?", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void loadServerUrl(String url) {
        progressBar.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                // If on home view of dashboard, back button returns to the server selection configuration
                webView.setVisibility(View.GONE);
                setupLayout.setVisibility(View.VISIBLE);
                Toast.makeText(this, "Disconnected from dashboard. You can modify server IP.", Toast.LENGTH_SHORT).show();
            }
        } else {
            super.onBackPressed();
        }
    }
}
