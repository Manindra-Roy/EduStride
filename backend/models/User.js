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
  },
  tokenVersion: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

userSchema.index(
  { studentProfile: 1 },
  { unique: true, partialFilterExpression: { studentProfile: { $type: 'objectId' } }, name: 'unique_student_profile' }
);
userSchema.index({ role: 1 });
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'SuperAdmin' }, name: 'unique_superadmin_role' }
);

export default mongoose.model('User', userSchema);
