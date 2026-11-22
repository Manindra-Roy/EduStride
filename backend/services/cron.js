import cron from 'node-cron';
import { sendEmail } from './mailService.js';
import { getISTParts } from './attendanceSync.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import FeeLedger from '../models/FeeLedger.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const resolveRecipientEmail = (student, userEmailByStudentId) => {
  if (student.parent_email && student.parent_email.includes('@')) {
    return student.parent_email.trim();
  }
  const linkedEmail = userEmailByStudentId.get(String(student._id));
  if (linkedEmail && linkedEmail.includes('@')) {
    return linkedEmail.trim();
  }
  return null;
};

const batchFetchUserEmails = async (studentIds) => {
  const map = new Map();
  if (!studentIds || studentIds.length === 0) return map;
  const users = await User.find({ studentProfile: { $in: studentIds } })
    .select('studentProfile email')
    .lean();
  for (const u of users) {
    if (u.studentProfile && u.email) {
      map.set(String(u.studentProfile), u.email);
    }
  }
  return map;
};

export const initCronJobs = () => {
  console.log('Initializing background cron jobs...');

  // 1. Fee nagging cron: Runs on the 5th of every month at 8:00 AM IST (0 8 5 * *)
  cron.schedule('0 8 5 * *', async () => {
    console.log('[CRON] Running Fee Nagging Job...');
    try {
      const ist = getISTParts();
      const currentYear = Number(ist.dateStr.slice(0, 4));
      const currentMonthIdx = Number(ist.dateStr.slice(5, 7)) - 1;
      const currentMonthName = MONTH_NAMES[currentMonthIdx];

      // Find all unpaid or partial ledgers for the current academic year & month
      const unpaidLedgers = await FeeLedger.find({
        year: currentYear,
        months: {
          $elemMatch: {
            month_name: currentMonthName,
            status: { $in: ['Unpaid', 'Partial/Pending'] }
          }
        }
      }).populate('student_id');

      const eligibleStudents = unpaidLedgers
        .map(l => l.student_id)
        .filter(s => s && s.status === 'Active' && !s.is_free_tier);

      const userEmails = await batchFetchUserEmails(eligibleStudents.map(s => s._id));

      for (const ledger of unpaidLedgers) {
        const student = ledger.student_id;
        if (!student || student.status !== 'Active' || student.is_free_tier) continue;

        const parentEmail = resolveRecipientEmail(student, userEmails);
        if (!parentEmail) {
          console.warn(`[Fee Nagging] Skipping ${student.name}: no registered email.`);
          continue;
        }

        const monthRecord = ledger.months.find(m => m.month_name === currentMonthName);
        const statusLabel = monthRecord?.status === 'Partial/Pending' ? 'PARTIALLY PAID / PENDING' : 'UNPAID';

        const mailOptions = {
          from: '"EduStride Admin" <admin@edustride.com>',
          to: parentEmail,
          subject: `Urgent: Tuition Fee Outstanding for ${student.name} - ${currentMonthName}`,
          text: `Dear ${student.parent_name},\n\nThis is a friendly reminder that the tuition fee of ₹${student.monthly_fee || 0} for ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}) for the month of ${currentMonthName} is currently ${statusLabel}. Please clear the outstanding balance via the student portal at edustride.in at your earliest convenience.\n\nBest regards,\nEduStride Administration`
        };

        try {
          await sendEmail(mailOptions);
          console.log(`[Fee Nagging] Sent reminder to ${student.parent_name} (${parentEmail}) for student ${student.name}`);
        } catch (mailErr) {
          console.error(`[Fee Nagging] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
        }
      }
    } catch (error) {
      console.error('[CRON Error] Fee Nagging failed:', error.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 2. Low Attendance Alerts: Runs weekly on Sundays at 9:00 AM IST (0 9 * * 0)
  // Scans for running monthly attendance below 75%
  cron.schedule('0 9 * * 0', async () => {
    console.log('[CRON] Running Low Attendance Scanner...');
    try {
      const ist = getISTParts();
      const currentMonthStr = ist.monthStr; // YYYY-MM in IST
      const students = await Student.find({ status: 'Active' });

      const lowAttendanceStudents = [];
      for (const student of students) {
        const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr);
        if (monthlyAttendance && monthlyAttendance.total_classes > 0) {
          const rate = (monthlyAttendance.attended / monthlyAttendance.total_classes) * 100;
          if (rate < 75) {
            lowAttendanceStudents.push({ student, rate });
          }
        }
      }

      const userEmails = await batchFetchUserEmails(lowAttendanceStudents.map(item => item.student._id));

      for (const { student, rate } of lowAttendanceStudents) {
        const parentEmail = resolveRecipientEmail(student, userEmails);
        if (!parentEmail) {
          console.warn(`[Attendance Alert] Skipping ${student.name}: no registered email.`);
          continue;
        }

        const mailOptions = {
          from: '"EduStride Academic Office" <academic@edustride.com>',
          to: parentEmail,
          subject: `Alert: Low Attendance Notice - ${student.name}`,
          text: `Dear ${student.parent_name},\n\nWe are writing to inform you that your ward, ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}), has a running attendance rate of ${rate.toFixed(1)}% for this month. This is below the required 75% threshold.\n\nPlease ensure they attend regular sessions. You can monitor daily attendance details on the student portal at edustride.in. Feel free to contact the class teacher if you have any queries.\n\nBest regards,\nAcademic Coordinator`
        };

        try {
          await sendEmail(mailOptions);
          console.log(`[Attendance Alert] Sent warning to ${student.parent_name} (${parentEmail}) for ${student.name} (${rate.toFixed(1)}%)`);
        } catch (mailErr) {
          console.error(`[Attendance Alert] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
        }
      }
    } catch (error) {
      console.error('[CRON Error] Low Attendance Scanner failed:', error.message);
    }
  }, { timezone: 'Asia/Kolkata' });
};
