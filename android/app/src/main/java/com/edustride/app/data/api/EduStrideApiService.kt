package com.edustride.app.data.api

import com.edustride.app.data.models.*
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Call
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

interface EduStrideApiService {

    @POST("api/auth/login")
    fun login(@Body request: LoginRequest): Call<LoginResponse>

    @GET("api/auth/me")
    fun getProfile(): Call<ApiResponseSingle<UserDto>>

    @GET("api/students")
    fun getStudents(
        @Query("class_level") classLevel: String? = null
    ): Call<ApiResponseList<StudentProfileDto>>

    @GET("api/study-materials")
    fun getStudyMaterials(): Call<ApiResponseList<Handout>>

    @PUT("api/auth/theme")
    fun updateThemePreference(
        @Body payload: Map<String, String?>
    ): Call<ApiResponseSingle<UserDto>>

    @Multipart
    @PUT("api/auth/profile-pic")
    fun uploadProfilePic(
        @Part avatar: MultipartBody.Part
    ): Call<ProfilePicResponse>

    companion object {
        fun create(prefsManager: PrefsManager): EduStrideApiService {
            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }

            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .addInterceptor(logging)
                .addInterceptor { chain ->
                    val original = chain.request()
                    val requestBuilder = original.newBuilder()
                    
                    // Attach Authorization JWT header if available
                    prefsManager.token?.let {
                        requestBuilder.header("Authorization", "Bearer $it")
                    }
                    
                    chain.proceed(requestBuilder.build())
                }
                .build()

            // Fetch dynamically and ensure trailing slash is present
            var baseUrl = prefsManager.serverUrl.trim()
            if (!baseUrl.endsWith("/")) {
                baseUrl += "/"
            }

            val retrofit = Retrofit.Builder()
                .baseUrl(baseUrl)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            return retrofit.create(EduStrideApiService::class.java)
        }
    }
}
