package com.edustride.app.data.models

// Auth Models
data class LoginRequest(
    val email: String,
    val password: String
)

data class LoginResponse(
    val success: Boolean,
    val token: String?,
    val message: String?,
    val user: UserDto?
)

data class UserDto(
    val id: String,
    val email: String,
    val role: String,
    val profile_pic: String?,
    val theme_color: String?,
    val studentProfile: StudentProfileDto?
)

data class StudentProfileDto(
    val id: String,
    val name: String,
    val class_level: String,
    val roll_number: Int,
    val attendance: AttendanceDto?,
    val fee_status: String?
)

data class AttendanceDto(
    val total_classes: Int,
    val attended_classes: Int
)

// List Response wrapper
data class ApiResponseList<T>(
    val success: Boolean,
    val data: List<T>?,
    val message: String?
)

data class ApiResponseSingle<T>(
    val success: Boolean,
    val data: T?,
    val message: String?
)

// LMS Handout Model
data class Handout(
    val _id: String,
    val title: String,
    val description: String?,
    val file_url: String,
    val class_level: String,
    val subject: String?,
    val pipeline_status: String?,
    val uploaded_by: String?,
    val created_at: String?
)

// Chat Message Model
data class ChatMessage(
    val _id: String?,
    val class_level: String,
    val sender_name: String,
    val content: String,
    val created_at: String?
)

data class ProfilePicResponse(
    val success: Boolean,
    val message: String?,
    val profile_pic: String?
)
