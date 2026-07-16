# Proguard Rules for EduStride Native App

# Keep Retrofit data models so they are not obfuscated during serialization/deserialization
-keep class com.edustride.app.data.models.** { *; }

# Keep Socket.io client library references
-keep class io.socket.** { *; }

# Keep Glide annotations and classes
-keep public class * extends com.bumptech.glide.module.AppGlideModule
-keep class com.bumptech.glide.GeneratedAppGlideModuleImpl
