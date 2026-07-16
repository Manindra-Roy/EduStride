package com.edustride.app.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.edustride.app.data.api.EduStrideApiService
import com.edustride.app.data.models.LoginRequest
import com.edustride.app.data.models.LoginResponse
import com.edustride.app.data.models.PrefsManager
import com.edustride.app.databinding.ActivityLoginBinding
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var prefsManager: PrefsManager
    private lateinit var apiService: EduStrideApiService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        prefsManager = PrefsManager(this)
        
        // Auto-redirect to Dashboard if already authenticated
        if (prefsManager.token != null) {
            startActivity(Intent(this, DashboardActivity::class.java))
            finish()
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        apiService = EduStrideApiService.create(prefsManager)

        binding.btnLogin.setOnClickListener {
            handleLogin()
        }
    }

    private fun handleLogin() {
        val email = binding.edtEmail.text.toString().trim()
        val password = binding.edtPassword.text.toString().trim()

        if (email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Please enter email and password", Toast.LENGTH_SHORT).show()
            return
        }

        binding.loadingSpinner.visibility = View.VISIBLE
        binding.btnLogin.isEnabled = false

        val request = LoginRequest(email, password)
        apiService.login(request).enqueue(object : Callback<LoginResponse> {
            override fun onResponse(call: Call<LoginResponse>, response: Response<LoginResponse>) {
                binding.loadingSpinner.visibility = View.GONE
                binding.btnLogin.isEnabled = true

                if (response.isSuccessful) {
                    val loginResponse = response.body()
                    if (loginResponse != null && loginResponse.success && loginResponse.token != null) {
                        // Save token & user session details
                        prefsManager.token = loginResponse.token
                        prefsManager.user = loginResponse.user
                        
                        Toast.makeText(this@LoginActivity, "Login successful", Toast.LENGTH_SHORT).show()
                        
                        // Proceed to main Dashboard activity
                        startActivity(Intent(this@LoginActivity, DashboardActivity::class.java))
                        finish()
                    } else {
                        val errorMsg = loginResponse?.message ?: "Authentication failed"
                        Toast.makeText(this@LoginActivity, errorMsg, Toast.LENGTH_LONG).show()
                    }
                } else {
                    Toast.makeText(this@LoginActivity, "Invalid email or password", Toast.LENGTH_LONG).show()
                }
            }

            override fun onFailure(call: Call<LoginResponse>, t: Throwable) {
                binding.loadingSpinner.visibility = View.GONE
                binding.btnLogin.isEnabled = true
                Toast.makeText(this@LoginActivity, "Connection error: ${t.message}", Toast.LENGTH_LONG).show()
            }
        })
    }
}
// Fix typo in onFailure callback name (has Chinese char 密 in it)
