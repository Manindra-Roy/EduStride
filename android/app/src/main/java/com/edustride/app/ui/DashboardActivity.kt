package com.edustride.app.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.bumptech.glide.Glide
import com.edustride.app.R
import com.edustride.app.data.api.EduStrideApiService
import com.edustride.app.data.models.ApiResponseList
import com.edustride.app.data.models.Handout
import com.edustride.app.data.models.PrefsManager
import com.edustride.app.data.models.StudentProfileDto
import com.edustride.app.databinding.ActivityDashboardBinding
import com.edustride.app.ui.adapters.HandoutAdapter
import com.edustride.app.ui.adapters.StudentAdapter
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class DashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDashboardBinding
    private lateinit var prefsManager: PrefsManager
    private lateinit var apiService: EduStrideApiService

    private lateinit var studentAdapter: StudentAdapter
    private lateinit var handoutAdapter: HandoutAdapter

    private var activeTabId = R.id.nav_home

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        prefsManager = PrefsManager(this)
        if (prefsManager.token == null) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        binding = ActivityDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        apiService = EduStrideApiService.create(prefsManager)

        setupUI()
        setupRecyclerViews()
        loadData()
    }

    override fun onResume() {
        super.onResume()
        // Refresh avatar and color accents when returning from Profile settings
        updateHeaderBranding()
    }

    private fun setupUI() {
        // Welcome Text
        val user = prefsManager.user
        binding.txtWelcome.text = "Welcome, ${user?.email?.split("@")?.get(0) ?: "Member"}!"
        binding.txtRoleBadge.text = "${user?.role?.uppercase()} ACCOUNT"

        // Open chat logs action
        binding.btnOpenChats.setOnClickListener {
            val intent = Intent(this, ChatActivity::class.java)
            startActivity(intent)
        }

        // Open settings profile action
        binding.imgUserProfile.setOnClickListener {
            val intent = Intent(this, ProfileActivity::class.java)
            startActivity(intent)
        }

        // Bottom Navigation selection listener
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            activeTabId = item.itemId
            when (item.itemId) {
                R.id.nav_home -> {
                    binding.txtSectionHeader.text = "Class Roster Ledger"
                    binding.rvDashboardList.adapter = studentAdapter
                    loadStudents()
                    true
                }
                R.id.nav_lms -> {
                    binding.txtSectionHeader.text = "LMS Study Materials Library"
                    binding.rvDashboardList.adapter = handoutAdapter
                    loadHandouts()
                    true
                }
                else -> false
            }
        }

        // Pull to refresh action
        binding.swipeRefreshDashboard.setOnRefreshListener {
            loadData()
        }
    }

    private fun setupRecyclerViews() {
        binding.rvDashboardList.layoutManager = LinearLayoutManager(this)

        studentAdapter = StudentAdapter(emptyList())
        handoutAdapter = HandoutAdapter(emptyList()) { handout ->
            // Download handler: Open download URI in mobile browser
            try {
                var fileUrl = handout.file_url
                if (fileUrl.startsWith("/uploads")) {
                    var base = prefsManager.serverUrl.trim()
                    if (base.endsWith("/")) {
                        base = base.substring(0, base.length - 1)
                    }
                    fileUrl = base + fileUrl
                }
                val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(fileUrl))
                startActivity(browserIntent)
            } catch (e: Exception) {
                Toast.makeText(this, "Failed to open document download URL", Toast.LENGTH_SHORT).show()
            }
        }

        // Default adapter
        binding.rvDashboardList.adapter = studentAdapter
    }

    private fun loadData() {
        binding.swipeRefreshDashboard.isRefreshing = true
        if (activeTabId == R.id.nav_home) {
            loadStudents()
        } else {
            loadHandouts()
        }
    }

    private fun loadStudents() {
        val user = prefsManager.user
        val classFilter = user?.studentProfile?.class_level
        
        apiService.getStudents(classFilter).enqueue(object : Callback<ApiResponseList<StudentProfileDto>> {
            override fun onResponse(
                call: Call<ApiResponseList<StudentProfileDto>>,
                response: Response<ApiResponseList<StudentProfileDto>>
            ) {
                binding.swipeRefreshDashboard.isRefreshing = false
                if (response.isSuccessful) {
                    val list = response.body()?.data ?: emptyList()
                    studentAdapter.updateData(list)
                } else {
                    Toast.makeText(this@DashboardActivity, "Failed to load class roster", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ApiResponseList<StudentProfileDto>>, t: Throwable) {
                binding.swipeRefreshDashboard.isRefreshing = false
                Toast.makeText(this@DashboardActivity, "Roster network failure: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun loadHandouts() {
        apiService.getStudyMaterials().enqueue(object : Callback<ApiResponseList<Handout>> {
            override fun onResponse(
                call: Call<ApiResponseList<Handout>>,
                response: Response<ApiResponseList<Handout>>
            ) {
                binding.swipeRefreshDashboard.isRefreshing = false
                if (response.isSuccessful) {
                    val list = response.body()?.data ?: emptyList()
                    handoutAdapter.updateData(list)
                } else {
                    Toast.makeText(this@DashboardActivity, "Failed to load syllabus library", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onFailure(call: Call<ApiResponseList<Handout>>, t: Throwable) {
                binding.swipeRefreshDashboard.isRefreshing = false
                Toast.makeText(this@DashboardActivity, "LMS Library network failure: ${t.message}", Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun updateHeaderBranding() {
        val user = prefsManager.user
        
        // Cache theme choice locally
        val activeTheme = user?.theme_color ?: "indigo"
        prefsManager.themeAccent = activeTheme

        // Load Avatar image via Glide
        val avatarUrl = user?.profile_pic
        if (!avatarUrl.isNullOrEmpty()) {
            var fullAvatarUrl = avatarUrl
            if (avatarUrl.startsWith("/uploads")) {
                var base = prefsManager.serverUrl.trim()
                if (base.endsWith("/")) {
                    base = base.substring(0, base.length - 1)
                }
                fullAvatarUrl = base + avatarUrl
            }
            Glide.with(this)
                .load(fullAvatarUrl)
                .placeholder(android.R.drawable.ic_menu_myplaces)
                .error(android.R.drawable.ic_menu_myplaces)
                .into(binding.imgAvatar)
        } else {
            binding.imgAvatar.setImageResource(android.R.drawable.ic_menu_myplaces)
        }
    }
}
