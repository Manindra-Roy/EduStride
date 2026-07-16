package com.edustride.app.ui.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.edustride.app.R
import com.edustride.app.data.models.StudentProfileDto
import com.edustride.app.databinding.ItemStudentBinding

class StudentAdapter(
    private var students: List<StudentProfileDto>
) : RecyclerView.Adapter<StudentAdapter.StudentViewHolder>() {

    class StudentViewHolder(val binding: ItemStudentBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): StudentViewHolder {
        val binding = ItemStudentBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return StudentViewHolder(binding)
    }

    override fun onBindViewHolder(holder: StudentViewHolder, position: Int) {
        val student = students[position]
        val context = holder.itemView.context

        holder.binding.txtStudentName.text = student.name
        holder.binding.txtRollNumber.text = "Roll No: ${student.roll_number}"
        
        // Render attendance stats
        val attendance = student.attendance
        if (attendance != null && attendance.total_classes > 0) {
            val percentage = (attendance.attended_classes.toDouble() / attendance.total_classes * 100).toInt()
            holder.binding.txtAttendanceStats.text = "$percentage% Attendance (${attendance.attended_classes}/${attendance.total_classes})"
            
            // Highlight low attendance
            if (percentage < 75) {
                holder.binding.txtAttendanceStats.setTextColor(ContextCompat.getColor(context, android.R.color.holo_red_light))
            } else {
                holder.binding.txtAttendanceStats.setTextColor(ContextCompat.getColor(context, android.R.color.darker_gray))
            }
        } else {
            holder.binding.txtAttendanceStats.text = "No attendance logged"
            holder.binding.txtAttendanceStats.setTextColor(ContextCompat.getColor(context, android.R.color.darker_gray))
        }

        // Render tuition ledger status
        val status = student.fee_status ?: "Unpaid"
        holder.binding.txtLedgerStatus.text = status.uppercase()
        when (status.lowercase()) {
            "paid" -> {
                holder.binding.txtLedgerStatus.setTextColor(ContextCompat.getColor(context, android.R.color.holo_green_light))
                holder.binding.cardStatusIndicator.setCardBackgroundColor(ContextCompat.getColor(context, android.R.color.holo_green_dark))
            }
            "partial" -> {
                holder.binding.txtLedgerStatus.setTextColor(ContextCompat.getColor(context, android.R.color.holo_orange_light))
                holder.binding.cardStatusIndicator.setCardBackgroundColor(ContextCompat.getColor(context, android.R.color.holo_orange_dark))
            }
            else -> {
                holder.binding.txtLedgerStatus.setTextColor(ContextCompat.getColor(context, android.R.color.holo_red_light))
                holder.binding.cardStatusIndicator.setCardBackgroundColor(ContextCompat.getColor(context, android.R.color.holo_red_dark))
            }
        }
    }

    override fun getItemCount(): Int = students.size

    fun updateData(newStudents: List<StudentProfileDto>) {
        students = newStudents
        notifyDataSetChanged()
    }
}
