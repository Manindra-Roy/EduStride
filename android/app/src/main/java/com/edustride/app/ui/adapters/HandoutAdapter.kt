package com.edustride.app.ui.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.edustride.app.data.models.Handout
import com.edustride.app.databinding.ItemHandoutBinding

class HandoutAdapter(
    private var handouts: List<Handout>,
    private val onDownloadClick: (Handout) -> Unit
) : RecyclerView.Adapter<HandoutAdapter.HandoutViewHolder>() {

    class HandoutViewHolder(val binding: ItemHandoutBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): HandoutViewHolder {
        val binding = ItemHandoutBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return HandoutViewHolder(binding)
    }

    override fun onBindViewHolder(holder: HandoutViewHolder, position: Int) {
        val handout = handouts[position]

        holder.binding.txtHandoutTitle.text = handout.title
        holder.binding.txtHandoutDesc.text = handout.description ?: "Syllabus details"
        holder.binding.txtSubjectBadge.text = (handout.subject ?: "General").uppercase()
        holder.binding.txtClassLevel.text = "Class ${handout.class_level}"
        holder.binding.txtPipelineStatus.text = handout.pipeline_status ?: "Distributed"

        holder.binding.btnDownload.setOnClickListener {
            onDownloadClick(handout)
        }
    }

    override fun getItemCount(): Int = handouts.size

    fun updateData(newHandouts: List<Handout>) {
        handouts = newHandouts
        notifyDataSetChanged()
    }
}
