import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['SuperAdmin', 'Teacher', 'Student'],
    required: true
  },
  studentProfile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    default: null
  },
  profile_pic: {
    type: String,
    default: null
  },
  theme_color: {
    type: String,
    enum: ['indigo', 'emerald', 'amber', 'rose', 'violet', 'cyan', null],
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model('User', userSchema);
