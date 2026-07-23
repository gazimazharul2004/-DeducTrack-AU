package com.example

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private var filePathCallback: ValueCallback<Array<android.net.Uri>>? = null

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        // Permission granted check
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }

        setContent {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background
            ) {
                AndroidView(
                    factory = { context ->
                        WebView(context).apply {
                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                allowFileAccess = true
                                allowContentAccess = true
                                mediaPlaybackRequiresUserGesture = false
                                cacheMode = WebSettings.LOAD_DEFAULT
                            }

                            addJavascriptInterface(
                                AndroidGeminiBridge(this@MainActivity, this),
                                "AndroidGeminiAI"
                            )

                            webChromeClient = object : WebChromeClient() {
                                override fun onPermissionRequest(request: PermissionRequest?) {
                                    request?.grant(request.resources)
                                }

                                override fun onShowFileChooser(
                                    webView: WebView?,
                                    filePathCallback: ValueCallback<Array<android.net.Uri>>?,
                                    fileChooserParams: FileChooserParams?
                                ): Boolean {
                                    this@MainActivity.filePathCallback = filePathCallback
                                    return super.onShowFileChooser(webView, filePathCallback, fileChooserParams)
                                }
                            }

                            webViewClient = object : WebViewClient() {}

                            loadUrl("file:///android_asset/index.html")
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}

class AndroidGeminiBridge(
    private val activity: ComponentActivity,
    private val webView: WebView
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @JavascriptInterface
    fun extractReceipt(dataUrl: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val apiKey = BuildConfig.GEMINI_API_KEY
                if (apiKey.isBlank() || apiKey == "your_api_key_here") {
                    notifyError("Gemini API key is not configured in Android app.")
                    return@launch
                }

                val cleanBase64 = if (dataUrl.contains(",")) {
                    dataUrl.substringAfter(",")
                } else {
                    dataUrl
                }

                val prompt = """
                Analyze this image carefully.
                1. Determine if this image is a readable purchase receipt, tax invoice, store receipt, or transaction record.
                2. IF the image is blank, dark, blurry, corrupt, or does NOT contain a readable receipt, set "isReceipt": false, "unreadableReason": "Image is blank, blurry, or not a readable receipt."
                3. IF it IS a readable receipt, extract the exact merchant name, total price/amount in AUD, transaction date, ABN, line item description, and tax category.
                Do NOT invent, guess, or fabricate any data if it is not visible in the image.
                Return ONLY a valid JSON object with schema:
                {
                  "isReceipt": true|false,
                  "unreadableReason": "Reason if false",
                  "description": "Short summary of items purchased",
                  "amount": 0.00,
                  "date": "YYYY-MM-DD",
                  "merchant": "Store name",
                  "abn": "ABN number if present",
                  "category": "work|vehicle|home|health|education|investment|donation|other",
                  "notes": "Optional notes"
                }
                """.trimIndent()

                val jsonBody = JSONObject().apply {
                    put("contents", org.json.JSONArray().apply {
                        put(JSONObject().apply {
                            put("parts", org.json.JSONArray().apply {
                                put(JSONObject().apply {
                                    put("text", prompt)
                                })
                                put(JSONObject().apply {
                                    put("inline_data", JSONObject().apply {
                                        put("mime_type", "image/jpeg")
                                        put("data", cleanBase64)
                                    })
                                })
                            })
                        })
                    })
                    put("generationConfig", JSONObject().apply {
                        put("response_mime_type", "application/json")
                    })
                }

                val requestBody = jsonBody.toString().toRequestBody("application/json".toMediaType())
                val url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$apiKey"

                val request = Request.Builder()
                    .url(url)
                    .post(requestBody)
                    .build()

                val response = client.newCall(request).execute()
                val responseString = response.body?.string() ?: ""

                if (response.isSuccessful) {
                    val root = JSONObject(responseString)
                    val candidates = root.optJSONArray("candidates")
                    if (candidates != null && candidates.length() > 0) {
                        val content = candidates.getJSONObject(0).optJSONObject("content")
                        val parts = content?.optJSONArray("parts")
                        if (parts != null && parts.length() > 0) {
                            val text = parts.getJSONObject(0).optString("text")
                            activity.runOnUiThread {
                                webView.evaluateJavascript("window.onAndroidAIExtracted(${JSONObject.quote(text)});", null)
                            }
                            return@launch
                        }
                    }
                }
                notifyError("Gemini API request failed (HTTP ${response.code})")
            } catch (e: Exception) {
                notifyError("Error scanning receipt: ${e.localizedMessage ?: "Unknown error"}")
            }
        }
    }

    private fun notifyError(msg: String) {
        activity.runOnUiThread {
            webView.evaluateJavascript("console.error(${JSONObject.quote(msg)}); if (typeof window.onAndroidAIError === 'function') { window.onAndroidAIError(${JSONObject.quote(msg)}); }", null)
        }
    }
}
