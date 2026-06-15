import mongoose from 'mongoose';

const timetableSchema = new mongoose.Schema({
  data: {
    type: Array,
    required: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Timetable', timetableSchema);
