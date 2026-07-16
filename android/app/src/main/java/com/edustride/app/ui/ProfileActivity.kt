package com.edustride.app.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.widget.RadioButton
import android.widget.SeekBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.bumptech.glide.Glide
import com.edustride.app.R
import com.edustride.app.data.api.EduStrideApiService
import com.edustride.app.data.models.ApiResponseSingle
import com.edustride.app.data.models.LoginResponse
import com.edustride.app.data.models.PrefsManager
import com.edustride.app.data.models.UserDto
import com.edustride.app.data.models.ProfilePicResponse
import com.edustride.app.databinding.ActivityProfileBinding
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

class ProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProfileBinding
    private lateinit var prefsManager: PrefsManager
    private lateinit var apiService: EduStrideApiService

    private var rawSelectedBitmap: Bitmap? = null
    private var croppedUploadBitmap: Bitmap? = null

    // Image Picker launcher
    private val imagePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val uri = result.data?.data
            if (uri != null) {
                loadRawBitmap(uri)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        prefsManager = PrefsManager(this)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        apiService = EduStrideApiService.create(prefsManager)

        binding.profileToolbar.setNavigationOnClickListener {
            onBackPressed()
        }

        setupProfileDetails()
        setupCropSliders()
        setupThemeSelector()

        binding.btnChooseAvatar.setOnClickListener {
            val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
            imagePickerLauncher.launch(intent)
        }

        binding.btnSaveAvatar.setOnClickListener {
            uploadCroppedAvatar()
        }
    }

    private fun setupProfileDetails() {
        val user = prefsManager.user
        binding.txtUserName.text = user?.studentProfile?.name ?: (if (user?.role == "SuperAdmin") "Admin" else "Teacher")
        binding.txtUserRole.text = "${user?.role} Account"

        // Load Avatar via Glide
        val avatarUrl = user?.profile_pic
        if (!avatarUrl.isNullOrEmpty()) {
            var fullAvatarUrl = avatarUrl
            if (avatarUrl.startsWith("/uploads")) {
                fullAvatarUrl = "http://10.0.2.2:5000" + avatarUrl
            }
            Glide.with(this)
                .load(fullAvatarUrl)
                .placeholder(android.R.drawable.ic_menu_myplaces)
                .into(binding.imgLargeProfile)
        }
    }

    private fun loadRawBitmap(uri: Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri)
            val originalBitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()

            if (originalBitmap != null) {
                // Downscale raw image slightly if massive to prevent Memory issues
                val maxDimension = 1200
                rawSelectedBitmap = if (originalBitmap.width > maxDimension || originalBitmap.height > maxDimension) {
                    val ratio = originalBitmap.width.toFloat() / originalBitmap.height.toFloat()
                    val newW = if (ratio > 1) maxDimension else (maxDimension * ratio).toInt()
                    val newH = if (ratio > 1) (maxDimension / ratio).toInt() else maxDimension
                    Bitmap.createScaledBitmap(originalBitmap, newW, newH, true)
                } else {
                    originalBitmap
                }

                // Make cropper panel layout visible
                binding.layoutCropper.visibility = View.VISIBLE
                
                // Reset seekbar parameters
                binding.sbZoom.progress = 0 // 1.0x
                binding.sbPanX.progress = 100 // centered
                binding.sbPanY.progress = 100 // centered
                
                renderLiveCropPreview()
            }
        } catch (e: IOException) {
            Toast.makeText(this, "Failed to load chosen image", Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupCropSliders() {
        val listener = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                renderLiveCropPreview()
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        }

        binding.sbZoom.setOnSeekBarChangeListener(listener)
        binding.sbPanX.setOnSeekBarChangeListener(listener)
        binding.sbPanY.setOnSeekBarChangeListener(listener)
    }

    private fun renderLiveCropPreview() {
        val raw = rawSelectedBitmap ?: return

        // 1. Zoom factor: map progress 0..200 to scale 1.0..3.0
        val zoom = 1.0f + (binding.sbZoom.progress / 200.0f) * 2.0f

        // 2. Pan translations: map progress 0..200 (centered at 100) to px offset range -250..250
        val panX = (binding.sbPanX.progress - 100.0f) * 2.5f
        val panY = (binding.sbPanY.progress - 100.0f) * 2.5f

        // Create the cropped output bitmap (500x500 square)
        val size = 500
        val cropped = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(cropped)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)

        // Calculate aspect ratios & fit to canvas shorter side
        var w = size.toFloat()
        var h = size.toFloat()
        if (raw.width > raw.height) {
            w = size.toFloat() * (raw.width.toFloat() / raw.height.toFloat())
        } else {
            h = size.toFloat() * (raw.height.toFloat() / raw.width.toFloat())
        }

        // Apply zoom scale
        val sw = w * zoom
        val sh = h * zoom

        // Symmetrical centering
        val cx = (size - sw) / 2f
        val cy = (size - sh) / 2f

        // Draw onto the canvas with pan offsets
        val destRect = RectF(cx + panX, cy + panY, cx + panX + sw, cy + panY + sh)
        canvas.drawBitmap(raw, null, destRect, paint)

        // Show panned crop preview in UI
        binding.imgCropPreview.setImageBitmap(cropped)
        croppedUploadBitmap = cropped
    }

    private fun uploadCroppedAvatar() {
        val cropped = croppedUploadBitmap
        if (cropped == null) {
            Toast.makeText(this, "Please select and adjust an image first", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnSaveAvatar.isEnabled = false
        binding.btnSaveAvatar.text = "Uploading..."

        // Save Bitmap to a temporary local file
        val tempFile = File(cacheDir, "temp_avatar.jpg")
        try {
            val fos = FileOutputStream(tempFile)
            cropped.compress(Bitmap.CompressFormat.JPEG, 95, fos)
            fos.flush()
            fos.close()
        } catch (e: IOException) {
            Toast.makeText(this, "Failed to prepare image file", Toast.LENGTH_SHORT).show()
            binding.btnSaveAvatar.isEnabled = true
            binding.btnSaveAvatar.text = "Save Repositioned Avatar"
            return
        }

        // Prepare multipart body
        val requestFile = tempFile.asRequestBody("image/jpeg".toMediaTypeOrNull())
        val body = MultipartBody.Part.createFormData("avatar", tempFile.name, requestFile)

        apiService.uploadProfilePic(body).enqueue(object : Callback<ProfilePicResponse> {
            override fun onResponse(call: Call<ProfilePicResponse>, response: Response<ProfilePicResponse>) {
                binding.btnSaveAvatar.isEnabled = true
                binding.btnSaveAvatar.text = "Save Repositioned Avatar"

                if (response.isSuccessful) {
                    val res = response.body()
                    if (res != null && res.success && res.profile_pic != null) {
                        Toast.makeText(this@ProfileActivity, "Profile picture uploaded!", Toast.LENGTH_SHORT).show()
                        
                        // Sync preference & reload large avatar view
                        val user = prefsManager.user?.copy(profile_pic = res.profile_pic)
                        prefsManager.user = user
                        
                        binding.layoutCropper.visibility = View.GONE
                        setupProfileDetails()
                    } else {
                        Toast.makeText(this@ProfileActivity, res?.message ?: "Upload failed", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(this@ProfileActivity, "Upload server error", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ProfilePicResponse>, t: Throwable) {
                binding.btnSaveAvatar.isEnabled = true
                binding.btnSaveAvatar.text = "Save Repositioned Avatar"
                Toast.makeText(this@ProfileActivity, "Network failure: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun setupThemeSelector() {
        val activeTheme = prefsManager.user?.theme_color

        when (activeTheme?.lowercase()) {
            "indigo" -> binding.rbThemeIndigo.isChecked = true
            "emerald" -> binding.rbThemeEmerald.isChecked = true
            "amber" -> binding.rbThemeAmber.isChecked = true
            "rose" -> binding.rbThemeRose.isChecked = true
            else -> binding.rbThemeSystemDefault.isChecked = true
        }

        binding.rgThemeSelector.setOnCheckedChangeListener { _, checkedId ->
            val colorKey = when (checkedId) {
                R.id.rbThemeIndigo -> "indigo"
                R.id.rbThemeEmerald -> "emerald"
                R.id.rbThemeAmber -> "amber"
                R.id.rbThemeRose -> "rose"
                else -> null
            }
            saveThemePreference(colorKey)
        }
    }

    private fun saveThemePreference(colorKey: String?) {
        val payload = mapOf("theme_color" to colorKey)
        
        apiService.updateThemePreference(payload).enqueue(object : Callback<ApiResponseSingle<UserDto>> {
            override fun onResponse(
                call: Call<ApiResponseSingle<UserDto>>,
                response: Response<ApiResponseSingle<UserDto>>
            ) {
                if (response.isSuccessful) {
                    val updatedUser = response.body()?.data
                    if (updatedUser != null) {
                        // Sync preference locally
                        val currentUser = prefsManager.user
                        if (currentUser != null) {
                            prefsManager.user = currentUser.copy(theme_color = updatedUser.theme_color)
                        }
                        Toast.makeText(this@ProfileActivity, "Theme accent synced successfully", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(this@ProfileActivity, "Failed to update theme selection", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ApiResponseSingle<UserDto>>, t: Throwable) {
                Toast.makeText(this@ProfileActivity, "Theme sync failure: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }
}
