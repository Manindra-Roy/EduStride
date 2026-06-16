import express from 'express';
import os from 'os';
import mongoose from 'mongoose';
import { sendEmail, verifyMailConfig } from '../services/mailService.js';
import { protect, authorize } from '../middleware/auth.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import FeeLedger from '../models/FeeLedger.js';
import Subject from '../models/Subject.js';
import ClassLevel from '../models/ClassLevel.js';

const router = express.Router();

// Helper to test mail service configuration
const testMailerConfig = async () => {
  return await verifyMailConfig();
};

// @desc    Get core system metrics and connection status
// @route   GET /api/automations/status
// @access  Private (SuperAdmin only)
router.get('/status', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Operational (Connected)' : 'Disconnected';
    const studentCount = await Student.countDocuments();
    const ledgerCount = await FeeLedger.countDocuments();
    const subjectCount = await Subject.countDocuments();
    const classCount = await ClassLevel.countDocuments();
    const mailerStatus = await testMailerConfig();

    const memory = {
      free: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      usage: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + '%'
    };

    res.json({
      success: true,
      data: {
        dbStatus,
        studentCount,
        ledgerCount,
        subjectCount,
        classCount,
        mailerStatus,
        memory,
        platform: os.platform(),
        nodeVersion: process.version,
        uptime: (process.uptime() / 60).toFixed(1) + ' min'
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Manually trigger Tuition Fee Reminder Nagging email alert
// @route   POST /api/automations/trigger-fee-nag
// @access  Private (SuperAdmin only)
router.post('/trigger-fee-nag', protect, authorize('SuperAdmin'), async (req, res, next) => {
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

    let sentCount = 0;
    for (const ledger of unpaidLedgers) {
      if (ledger.student_id && ledger.student_id.status === 'Active') {
        const student = ledger.student_id;
        const studentUser = await User.findOne({ studentProfile: student._id });
        const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;

        const mailOptions = {
          from: '"EduStride Admin" <admin@edustride.com>',
          to: parentEmail,
          subject: `Urgent: Tuition Fee Outstanding for ${student.name} - ${currentMonthName}`,
          text: `Dear ${student.parent_name},\n\nThis is a friendly reminder that the tuition fee of ₹${student.monthly_fee || 1500} for ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}) for the month of ${currentMonthName} is currently UNPAID. Please clear the outstanding balance via the student portal at edustride.in at your earliest convenience.\n\nBest regards,\nEduStride Administration`
        };

        await sendEmail(mailOptions);
        sentCount++;
      }
    }

    res.json({
      success: true,
      message: `Tuition Fee Nagging executed successfully. Emailed ${sentCount} parents.`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Manually trigger Weekly Low Attendance Warnings scanner
// @route   POST /api/automations/trigger-attendance-alert
// @access  Private (SuperAdmin only)
router.post('/trigger-attendance-alert', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const currentMonthStr = new Date().toISOString().substring(0, 7);
    const students = await Student.find({ status: 'Active' });
    
    let sentCount = 0;
    for (const student of students) {
      const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr);
      if (monthlyAttendance && monthlyAttendance.total_classes > 0) {
        const rate = (monthlyAttendance.attended / monthlyAttendance.total_classes) * 100;
        if (rate < 75) {
          const studentUser = await User.findOne({ studentProfile: student._id });
          const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;
          const mailOptions = {
            from: '"EduStride Academic Office" <academic@edustride.com>',
            to: parentEmail,
            subject: `Alert: Low Attendance Notice - ${student.name}`,
            text: `Dear ${student.parent_name},\n\nWe are writing to inform you that your ward, ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}), has a running attendance rate of ${rate.toFixed(1)}% for this month. This is below the required 75% threshold.\n\nPlease ensure they attend regular sessions. You can monitor daily attendance details on the student portal at edustride.in. Feel free to contact the class teacher if you have any queries.\n\nBest regards,\nEduStride Academic Office`
          };

          await sendEmail(mailOptions);
          sentCount++;
        }
      }
    }

    res.json({
      success: true,
      message: `Low Attendance Warnings executed successfully. Warned ${sentCount} guardians.`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Manually trigger Monthly Student Progress Report mail and whatsapp dispatch
// @route   POST /api/automations/trigger-progress-report
// @access  Private (SuperAdmin only)
router.post('/trigger-progress-report', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { target, class_level, student_id } = req.body;

    const currentMonthIndex = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthsName = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = monthsName[currentMonthIndex];
    const currentMonthStr = new Date().toISOString().substring(0, 7);

    // Filter recipients based on custom parameters
    let recipients = [];
    if (target === 'class') {
      if (!class_level) {
        res.status(400);
        throw new Error('Please specify class_level');
      }
      recipients = await Student.find({ class_level, status: 'Active' });
    } else if (target === 'student') {
      if (!student_id) {
        res.status(400);
        throw new Error('Please specify student_id');
      }
      const student = await Student.findById(student_id);
      if (!student) {
        res.status(404);
        throw new Error('Student not found');
      }
      recipients = [student];
    } else {
      recipients = await Student.find({ status: 'Active' });
    }

    // Transporter initialization removed, handled in sendEmail

    const logs = [];
    let sentCount = 0;

    for (const student of recipients) {
      // 1. Calculate Monthly Attendance Rate
      const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr) || { total_classes: 0, attended: 0 };
      const totalClasses = monthlyAttendance.total_classes;
      const attended = monthlyAttendance.attended;
      const attendanceRate = totalClasses > 0 ? Math.round((attended / totalClasses) * 100) : 100;
      const attendanceColor = attendanceRate >= 75 ? '#10b981' : attendanceRate >= 50 ? '#f59e0b' : '#f43f5e';

      // 2. Fetch Fee Standing for current month
      const ledger = await FeeLedger.findOne({ student_id: student._id });
      const feeMonth = ledger?.months.find(m => m.month_name === currentMonthName) || { status: 'Unpaid', amount_paid: 0 };
      const feeStatus = feeMonth.status;
      const feeColor = feeStatus === 'Paid' ? '#10b981' : feeStatus === 'Partial/Pending' ? '#f59e0b' : '#f43f5e';

      // 3. Compile academic exam scores
      const recentScores = student.test_scores || [];
      const testCount = recentScores.length;
      const averagePercentage = testCount > 0 
        ? Math.round(recentScores.reduce((sum, s) => sum + (s.marks_obtained / s.total_marks * 100), 0) / testCount)
        : 0;

      // 4. Construct scores table for HTML email
      let scoresTableRows = '';
      if (recentScores.length > 0) {
        scoresTableRows = recentScores.map(score => {
          const percentage = Math.round((score.marks_obtained / score.total_marks) * 100);
          return `
            <tr style="border-bottom: 1px solid #edf2f7;">
              <td style="padding: 10px 5px; font-weight: bold; font-family: sans-serif;">${score.test_name}</td>
              <td style="padding: 10px 5px; color: #4a5568; font-family: sans-serif;">${score.subject}</td>
              <td style="padding: 10px 5px; font-size: 11px; color: #a0aec0; font-family: sans-serif;">${new Date(score.date).toLocaleDateString()}</td>
              <td style="padding: 10px 5px; text-align: right; font-weight: bold; font-family: sans-serif;">${score.marks_obtained} / ${score.total_marks}</td>
              <td style="padding: 10px 5px; text-align: right; color: #4f46e5; font-weight: bold; font-family: sans-serif;">${percentage}%</td>
            </tr>
          `;
        }).join('');
      } else {
        scoresTableRows = `
          <tr>
            <td colspan="5" style="padding: 20px; text-align: center; color: #a0aec0; font-style: italic; font-family: sans-serif;">No exam scores logged in this period.</td>
          </tr>
        `;
      }

      const scoresTable = `
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 2px solid #edf2f7; text-align: left; color: #718096; font-size: 11px; text-transform: uppercase; font-family: sans-serif;">
              <th style="padding: 8px 5px;">Test Name</th>
              <th style="padding: 8px 5px;">Subject</th>
              <th style="padding: 8px 5px;">Date</th>
              <th style="padding: 8px 5px; text-align: right;">Marks</th>
              <th style="padding: 8px 5px; text-align: right;">%</th>
            </tr>
          </thead>
          <tbody>
            ${scoresTableRows}
          </tbody>
        </table>
      `;

      // 5. Parent email
      const studentUser = await User.findOne({ studentProfile: student._id });
      const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;

      // 6. Send Email via Nodemailer
      const mailOptions = {
        from: '"EduStride Academic Office" <academic@edustride.com>',
        to: parentEmail,
        subject: `Monthly Progress Report: ${student.name} - ${currentMonthName} ${currentYear}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">EduStride Student Progress Report</h2>
              <p style="color: #718096; margin: 5px 0 0 0; font-size: 14px;">Report Period: ${currentMonthName} ${currentYear}</p>
            </div>
            
            <p>Dear <strong>${student.parent_name}</strong>,</p>
            <p>Please find below the monthly academic progress and attendance status report for your ward, <strong>${student.name}</strong> (Class ${student.class_level}, Roll No ${student.roll_number}), for the month of <strong>${currentMonthName}</strong>.</p>
            
            <div style="background-color: #f7fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #4f46e5; margin-bottom: 20px;">
              <h3 style="margin-top: 0; color: #2d3748; font-size: 16px;">Student Summary</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 4px 0; color: #718096; width: 35%;">Class Level:</td>
                  <td style="padding: 4px 0; font-weight: bold;">Class ${student.class_level}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #718096;">Roll Number:</td>
                  <td style="padding: 4px 0; font-weight: bold;">${student.roll_number}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #718096;">Monthly Attendance:</td>
                  <td style="padding: 4px 0; font-weight: bold; color: ${attendanceColor};">${attendanceRate}% (${attended}/${totalClasses} classes)</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #718096;">Tests Logged:</td>
                  <td style="padding: 4px 0; font-weight: bold;">${testCount} tests (Average: ${averagePercentage}%)</td>
                </tr>
              </table>
            </div>
            
            <div style="margin-bottom: 20px;">
              <h3 style="color: #2d3748; font-size: 16px; border-bottom: 1px solid #edf2f7; padding-bottom: 8px; margin-bottom: 12px;">Academic Evaluation & Exam Scores</h3>
              ${scoresTable}
            </div>
            
            <p style="font-size: 13px; color: #4a5568; line-height: 1.5; margin-top: 20px; margin-bottom: 20px;">
              Please log in to the student portal (<a href="https://edustride.in" style="color: #4f46e5; text-decoration: none; font-weight: bold;">EduStride.in</a>) to view detailed gradebooks and schedules.
            </p>
            
            <div style="font-size: 12px; color: #a0aec0; text-align: center; border-top: 1px solid #edf2f7; padding-top: 15px; margin-top: 30px;">
              This is an automated system dispatch from your school portal (<a href="https://edustride.in" style="color: #4f46e5; text-decoration: none; font-weight: bold;">edustride.in</a>).<br>
              Please do not reply directly to this email. For any queries, contact the academic coordinator.
            </div>
          </div>
        `
      };

      await sendEmail(mailOptions);

      // 7. Simulate WhatsApp sending (print details into console log)
      const whatsappText = `📝 *Monthly Progress Report* 📝\n\nDear *${student.parent_name}*,\nHere is the academic progress report for *${student.name}* (Class *${student.class_level}*, Roll *${student.roll_number}*) for *${currentMonthName}*:\n\n📊 *Academic Performance:*\n- Tests Conducted: *${testCount}*\n- Average Score: *${averagePercentage}%*\n\n📅 *Attendance Status:*\n- Attended: *${attended}* / *${totalClasses}* classes (${attendanceRate}%)\n- Compliance: *${attendanceRate >= 75 ? 'Yes' : 'Low Attendance Alert' }*\n\nPlease log in to the student portal to view detailed gradebooks and schedules.\nBest regards,\n*EduStride Academic Center*`;
      
      console.log(`=======================================================`);
      console.log(`[SIMULATED WHATSAPP MESSAGE DISPATCHED]`);
      console.log(`To: +91 ${student.primary_contact}`);
      console.log(`Body:`);
      console.log(whatsappText);
      console.log(`=======================================================`);

      sentCount++;
      const numericPhone = student.primary_contact.replace(/\D/g, '');
      const whatsappLink = `https://api.whatsapp.com/send?phone=${numericPhone.startsWith('91') ? numericPhone : '91' + numericPhone}&text=${encodeURIComponent(whatsappText)}`;

      logs.push({
        studentName: student.name,
        rollNumber: student.roll_number,
        parentName: student.parent_name,
        email: parentEmail,
        phone: student.primary_contact,
        whatsappLink,
        averagePercentage,
        attendanceRate
      });
    }

    res.json({
      success: true,
      message: `Progress Reports processed successfully. Sent ${sentCount} Emails and simulated ${sentCount} WhatsApp alerts.`,
      data: logs
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Send custom announcement email class-wise or student-wise
// @route   POST /api/automations/send-custom-email
// @access  Private (SuperAdmin only)
router.post('/send-custom-email', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { target, class_level, student_id, subject, body } = req.body;

    if (!subject || !body) {
      res.status(400);
      throw new Error('Please provide both subject and body for the email');
    }

    let recipients = [];

    if (target === 'class') {
      if (!class_level) {
        res.status(400);
        throw new Error('Please specify class_level');
      }
      const students = await Student.find({ class_level, status: 'Active' });
      if (students.length === 0) {
        res.status(404);
        throw new Error(`No active students found in Class ${class_level}`);
      }
      recipients = students;
    } else if (target === 'student') {
      if (!student_id) {
        res.status(400);
        throw new Error('Please specify student_id');
      }
      const student = await Student.findById(student_id);
      if (!student) {
        res.status(404);
        throw new Error('Student not found');
      }
      recipients = [student];
    } else {
      res.status(400);
      throw new Error('Invalid send target. Must be class or student');
    }

    let sentCount = 0;
    const sentList = [];

    for (const student of recipients) {
      const studentUser = await User.findOne({ studentProfile: student._id });
      const parentEmail = studentUser ? studentUser.email : `${student.parent_name.toLowerCase().replace(/\s+/g, '')}@example.com`;

      await sendEmail({
        from: '"EduStride Admin" <admin@edustride.com>',
        to: parentEmail,
        subject: subject,
        text: `Dear ${student.parent_name},\n\n${body}\n\nBest regards,\nEduStride Administration`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">EduStride Academic Announcement</h2>
            </div>
            
            <p>Dear <strong>${student.parent_name}</strong> (Parent of ${student.name}),</p>
            <div style="line-height: 1.6; margin: 20px 0; font-size: 14px; white-space: pre-line; color: #2d3748;">
              ${body}
            </div>
            
            <p style="font-size: 13px; color: #4a5568; line-height: 1.5; margin-top: 20px; margin-bottom: 20px;">
              Please log in to the student portal (<a href="https://edustride.in" style="color: #4f46e5; text-decoration: none; font-weight: bold;">EduStride.in</a>) to view detailed gradebooks and schedules.
            </p>
            
            <div style="font-size: 11px; color: #a0aec0; text-align: center; border-top: 1px solid #edf2f7; padding-top: 15px; margin-top: 30px;">
              This is a direct administrative communication broadcasted from your school portal (<a href="https://edustride.in" style="color: #4f46e5; text-decoration: none; font-weight: bold;">edustride.in</a>).<br>
              Please do not reply directly to this email. For any queries, contact the administration.
            </div>
          </div>
        `
      });

      sentCount++;
      sentList.push({
        studentName: student.name,
        parentName: student.parent_name,
        email: parentEmail
      });
    }

    res.json({
      success: true,
      message: `Custom email sent successfully to ${sentCount} recipient(s).`,
      data: sentList
    });
  } catch (error) {
    next(error);
  }
});

export default router;
