import cron from 'node-cron';
import { sendEmail } from './mailService.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import FeeLedger from '../models/FeeLedger.js';

export const initCronJobs = () => {
  console.log('Initializing background cron jobs...');

  // 1. Fee nagging cron: Runs on the 5th of every month at 8:00 AM (0 8 5 * *)
  cron.schedule('0 8 5 * *', async () => {
    console.log('[CRON] Running Fee Nagging Job...');
    try {
      const currentMonthName = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ][new Date().getMonth()];

      // Find all unpaid ledgers
      const unpaidLedgers = await FeeLedger.find({
        'months': {
          $elemMatch: {
            month_name: currentMonthName,
            status: 'Unpaid'
          }
        }
      }).populate('student_id');

      for (const ledger of unpaidLedgers) {
        if (ledger.student_id && ledger.student_id.status === 'Active') {
          const student = ledger.student_id;
          const studentUser = await User.findOne({ studentProfile: student._id });
          const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;

          const mailOptions = {
            from: '"School ERP Admin" <admin@schoolerp.com>',
            to: parentEmail,
            subject: `Urgent: Tuition Fee Outstanding for ${student.name} - ${currentMonthName}`,
            text: `Dear ${student.parent_name},\n\nThis is a friendly reminder that the tuition fee of ₹${student.monthly_fee || 1500} for ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}) for the month of ${currentMonthName} is currently UNPAID. Please clear the outstanding balance via the student portal at your earliest convenience.\n\nBest regards,\nSchool Administration`
          };

          await sendEmail(mailOptions);
          console.log(`[Fee Nagging] Sent reminder to ${student.parent_name} (${parentEmail}) for student ${student.name}`);
        }
      }
    } catch (error) {
      console.error('[CRON Error] Fee Nagging failed:', error.message);
    }
  });

  // 2. Low Attendance Alerts: Runs weekly on Sundays at 9:00 AM (0 9 * * 0)
  // Scans for running monthly attendance below 75%
  cron.schedule('0 9 * * 0', async () => {
    console.log('[CRON] Running Low Attendance Scanner...');
    try {
      const currentMonthStr = new Date().toISOString().substring(0, 7); // format: YYYY-MM
      const students = await Student.find({ status: 'Active' });

      for (const student of students) {
        const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr);
        if (monthlyAttendance && monthlyAttendance.total_classes > 0) {
          const rate = (monthlyAttendance.attended / monthlyAttendance.total_classes) * 100;
          if (rate < 75) {
            const studentUser = await User.findOne({ studentProfile: student._id });
            const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;
            const mailOptions = {
              from: '"School Academic Office" <academic@schoolerp.com>',
              to: parentEmail,
              subject: `Alert: Low Attendance Notice - ${student.name}`,
              text: `Dear ${student.parent_name},\n\nWe are writing to inform you that your ward, ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}), has a running attendance rate of ${rate.toFixed(1)}% for this month. This is below the required 75% threshold.\n\nPlease ensure they attend regular sessions. Feel free to contact the class teacher if you have any queries.\n\nBest regards,\nAcademic Coordinator`
            };

            await sendEmail(mailOptions);
            console.log(`[Attendance Alert] Sent warning to ${student.parent_name} (${parentEmail}) for ${student.name} (${rate.toFixed(1)}%)`);
          }
        }
      }
    } catch (error) {
      console.error('[CRON Error] Low Attendance Scanner failed:', error.message);
    }
  });
};
