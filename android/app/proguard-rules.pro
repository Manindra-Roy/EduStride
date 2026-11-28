# ProGuard / R8 Rules for EduStride Android App

# Preserve generic signatures and inner/enclosing class metadata
-keepattributes Signature, InnerClasses, EnclosingMethod

# Keep WebView @JavascriptInterface methods so JS bridge calls are never stripped or obfuscated
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Android 15+ dataSync FGS timeout callback (invoked via ART dispatch on API 35+)
-keepclassmembers class com.edustride.app.BackgroundSocketService {
    public void onTimeout(int, int);
}

# Keep Socket.io client library and JSON references
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-keep class org.json.** { *; }
-dontwarn org.json.**
