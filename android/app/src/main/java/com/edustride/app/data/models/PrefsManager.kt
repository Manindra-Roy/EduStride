package com.edustride.app.data.models

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson

class PrefsManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    companion object {
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_USER = "current_user"
        private const val KEY_THEME = "theme_accent"
        private const val KEY_SERVER = "server_url"
    }

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, "http://10.0.2.2:5000/") ?: "http://10.0.2.2:5000/"
        set(value) = prefs.edit().putString(KEY_SERVER, value).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var user: UserDto?
        get() {
            val json = prefs.getString(KEY_USER, null) ?: return null
            return try {
                gson.fromJson(json, UserDto::class.java)
            } catch (e: Exception) {
                null
            }
        }
        set(value) {
            val json = gson.toJson(value)
            prefs.edit().putString(KEY_USER, json).apply()
        }

    var themeAccent: String?
        get() = prefs.getString(KEY_THEME, "indigo")
        set(value) = prefs.edit().putString(KEY_THEME, value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }
}
