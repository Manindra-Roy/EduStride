import express from 'express';
import os from 'os';
import mongoose from 'mongoose';
import { sendEmail, verifyMailConfig } from '../services/mailService.js';
import { getISTParts } from '../services/attendanceSync.js';
import { escapeHtml } from '../utils/html.js';
import { protect, authorize } from '../middleware/auth.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import FeeLedger from '../models/FeeLedger.js';
import Subject from '../models/Subject.js';
import ClassLevel from '../models/ClassLevel.js';
import { getIO } from '../config/socket.js';

const router = express.Router();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

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

const resolveRecipientEmail = (student, userEmailMap) => {
  if (student.parent_email && student.parent_email.includes('@')) {
    return student.parent_email.trim();
  }
  const linked = userEmailMap.get(String(student._id));
  if (linked && linked.includes('@')) {
    return linked.trim();
  }
  return null;
};

// @desc    Get core system metrics and connection status
// @route   GET /api/automations/status
// @access  Private (SuperAdmin only)
router.get('/status', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Operational (Connected)' : 'Disconnected';
    const [studentCount, ledgerCount, subjectCount, classCount, mailerStatus] = await Promise.all([
      Student.countDocuments(),
      FeeLedger.countDocuments(),
      Subject.countDocuments(),
      ClassLevel.countDocuments(),
      verifyMailConfig()
    ]);

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
    const ist = getISTParts();
    const currentYear = Number(ist.dateStr.slice(0, 4));
    const currentMonthName = MONTH_NAMES[Number(ist.dateStr.slice(5, 7)) - 1];

    // Find all unpaid or partial ledgers for the current academic year
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

    let sentCount = 0;
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
        sentCount++;
      } catch (mailErr) {
        console.error(`[Fee Nagging] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
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
    const currentMonthStr = getISTParts().monthStr;
    const students = await Student.find({ status: 'Active' });

    const flagged = [];
    for (const student of students) {
      const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr);
      if (monthlyAttendance && monthlyAttendance.total_classes > 0) {
        const rate = (monthlyAttendance.attended / monthlyAttendance.total_classes) * 100;
        if (rate < 75) {
          flagged.push({ student, rate });
        }
      }
    }

    const userEmails = await batchFetchUserEmails(flagged.map(item => item.student._id));

    let sentCount = 0;
    for (const { student, rate } of flagged) {
      const parentEmail = resolveRecipientEmail(student, userEmails);
      if (!parentEmail) {
        console.warn(`[Attendance Alert] Skipping ${student.name}: no registered email.`);
        continue;
      }

      const mailOptions = {
        from: '"EduStride Academic Office" <academic@edustride.com>',
        to: parentEmail,
        subject: `Alert: Low Attendance Notice - ${student.name}`,
        text: `Dear ${student.parent_name},\n\nWe are writing to inform you that your ward, ${student.name} (Class ${student.class_level}, Roll No ${student.roll_number}), has a running attendance rate of ${rate.toFixed(1)}% for this month. This is below the required 75% threshold.\n\nPlease ensure they attend regular sessions. You can monitor daily attendance details on the student portal at edustride.in. Feel free to contact the class teacher if you have any queries.\n\nBest regards,\nEduStride Academic Office`
      };

      try {
        await sendEmail(mailOptions);
        sentCount++;
      } catch (mailErr) {
        console.error(`[Attendance Alert] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
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
    const { target, class_level, student_id } = req.body || {};

    const ist = getISTParts();
    const currentYear = Number(ist.dateStr.slice(0, 4));
    const currentMonthName = MONTH_NAMES[Number(ist.dateStr.slice(5, 7)) - 1];
    const currentMonthStr = ist.monthStr;

    // Filter recipients based on validated parameters
    let recipients = [];
    if (target === 'class') {
      if (typeof class_level !== 'string' || !class_level.trim()) {
        res.status(400);
        throw new Error('Please specify a valid class_level');
      }
      recipients = await Student.find({ class_level: class_level.trim().toUpperCase(), status: 'Active' });
    } else if (target === 'student') {
      if (typeof student_id !== 'string' || !student_id.trim()) {
        res.status(400);
        throw new Error('Please specify a valid student_id');
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

    const userEmails = await batchFetchUserEmails(recipients.map(s => s._id));

    const logs = [];
    let sentCount = 0;

    for (const student of recipients) {
      // 1. Calculate Monthly Attendance Rate
      const monthlyAttendance = student.attendance_history.find(h => h.month === currentMonthStr) || { total_classes: 0, attended: 0 };
      const totalClasses = monthlyAttendance.total_classes;
      const attended = monthlyAttendance.attended;
      const attendanceRate = totalClasses > 0 ? Math.round((attended / totalClasses) * 100) : 100;
      const attendanceColor = attendanceRate >= 75 ? '#10b981' : attendanceRate >= 50 ? '#f59e0b' : '#f43f5e';

      // 2. Compile academic exam scores (guarding total_marks > 0)
      const recentScores = student.test_scores || [];
      const validScores = recentScores.filter(s => Number(s.total_marks) > 0);
      const testCount = recentScores.length;
      const averagePercentage = validScores.length > 0
        ? Math.round(validScores.reduce((sum, s) => sum + ((s.marks_obtained / s.total_marks) * 100), 0) / validScores.length)
        : 0;

      // 3. Construct HTML-escaped scores table
      let scoresTableRows = '';
      if (recentScores.length > 0) {
        scoresTableRows = recentScores.map(score => {
          const percentage = Number(score.total_marks) > 0
            ? Math.round((score.marks_obtained / score.total_marks) * 100)
            : 0;
          return `
            <tr style="border-bottom: 1px solid #edf2f7;">
              <td style="padding: 10px 5px; font-weight: bold; font-family: sans-serif;">${escapeHtml(score.test_name)}</td>
              <td style="padding: 10px 5px; color: #4a5568; font-family: sans-serif;">${escapeHtml(score.subject)}</td>
              <td style="padding: 10px 5px; font-size: 11px; color: #a0aec0; font-family: sans-serif;">${escapeHtml(new Date(score.date).toLocaleDateString())}</td>
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

      // 4. Resolve parent email (prioritizing parent_email over linked User email)
      const parentEmail = resolveRecipientEmail(student, userEmails);

      const safeParentName = escapeHtml(student.parent_name);
      const safeStudentName = escapeHtml(student.name);
      const safeClassLevel = escapeHtml(student.class_level);
      const safeRollNumber = escapeHtml(student.roll_number);

      let emailSent = false;
      if (parentEmail) {
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
              
              <p>Dear <strong>${safeParentName}</strong>,</p>
              <p>Please find below the monthly academic progress and attendance status report for your ward, <strong>${safeStudentName}</strong> (Class ${safeClassLevel}, Roll No ${safeRollNumber}), for the month of <strong>${currentMonthName}</strong>.</p>
              
              <div style="background-color: #f7fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #4f46e5; margin-bottom: 20px;">
                <h3 style="margin-top: 0; color: #2d3748; font-size: 16px;">Student Summary</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #718096; width: 35%;">Class Level:</td>
                    <td style="padding: 4px 0; font-weight: bold;">Class ${safeClassLevel}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #718096;">Roll Number:</td>
                    <td style="padding: 4px 0; font-weight: bold;">${safeRollNumber}</td>
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

        try {
          await sendEmail(mailOptions);
          emailSent = true;
          sentCount++;
        } catch (mailErr) {
          console.error(`[Progress Report] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
        }
      } else {
        console.warn(`[Progress Report] Skipping email for ${student.name}: no registered email.`);
      }

      // 5. Build WhatsApp quick-send link safely (guarding primary_contact)
      const whatsappText = `📝 *Monthly Progress Report* 📝\n\nDear *${student.parent_name}*,\nHere is the academic progress report for *${student.name}* (Class *${student.class_level}*, Roll *${student.roll_number}*) for *${currentMonthName}*:\n\n📊 *Academic Performance:*\n- Tests Conducted: *${testCount}*\n- Average Score: *${averagePercentage}%*\n\n📅 *Attendance Status:*\n- Attended: *${attended}* / *${totalClasses}* classes (${attendanceRate}%)\n- Compliance: *${attendanceRate >= 75 ? 'Yes' : 'Low Attendance Alert'}*\n\nPlease log in to the student portal to view detailed gradebooks and schedules.\nBest regards,\n*EduStride Academic Center*`;

      const numericPhone = student.primary_contact ? String(student.primary_contact).replace(/\D/g, '') : '';
      const whatsappLink = numericPhone.length >= 10
        ? `https://api.whatsapp.com/send?phone=${numericPhone.startsWith('91') || numericPhone.length > 10 ? numericPhone : '91' + numericPhone}&text=${encodeURIComponent(whatsappText)}`
        : '';

      logs.push({
        studentName: student.name,
        rollNumber: student.roll_number,
        parentName: student.parent_name,
        email: parentEmail,
        emailSent,
        phone: student.primary_contact || '',
        whatsappLink,
        averagePercentage,
        attendanceRate
      });
    }

    res.json({
      success: true,
      message: `Progress Reports processed successfully. Emailed ${sentCount} of ${recipients.length} recipients.`,
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
    const { target, class_level, student_id, subject, body } = req.body || {};

    if (typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
      res.status(400);
      throw new Error('Please provide both subject and body for the email');
    }

    let recipients = [];
    let cleanClassLevel = '';

    if (target === 'class') {
      if (typeof class_level !== 'string' || !class_level.trim()) {
        res.status(400);
        throw new Error('Please specify a valid class_level');
      }
      cleanClassLevel = class_level.trim().toUpperCase();
      const students = await Student.find({ class_level: cleanClassLevel, status: 'Active' });
      if (students.length === 0) {
        res.status(404);
        throw new Error(`No active students found in Class ${cleanClassLevel}`);
      }
      recipients = students;
    } else if (target === 'student') {
      if (typeof student_id !== 'string' || !student_id.trim()) {
        res.status(400);
        throw new Error('Please specify a valid student_id');
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

    const userEmails = await batchFetchUserEmails(recipients.map(s => s._id));
    const safeBodyHtml = escapeHtml(body);

    let sentCount = 0;
    const sentList = [];

    for (const student of recipients) {
      const parentEmail = resolveRecipientEmail(student, userEmails);
      if (!parentEmail) {
        console.warn(`[Custom Email] Skipping ${student.name}: no registered email.`);
        continue;
      }

      const safeParentName = escapeHtml(student.parent_name);
      const safeStudentName = escapeHtml(student.name);

      try {
        await sendEmail({
          from: '"EduStride Admin" <admin@edustride.com>',
          to: parentEmail,
          subject: subject.trim(),
          text: `Dear ${student.parent_name},\n\n${body}\n\nBest regards,\nEduStride Administration`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
              <div style="text-align: center; border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">EduStride Academic Announcement</h2>
              </div>
              
              <p>Dear <strong>${safeParentName}</strong> (Parent of ${safeStudentName}),</p>
              <div style="line-height: 1.6; margin: 20px 0; font-size: 14px; white-space: pre-line; color: #2d3748;">
                ${safeBodyHtml}
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
      } catch (mailErr) {
        console.error(`[Custom Email] Failed sending email to ${parentEmail} for ${student.name}:`, mailErr.message);
      }
    }

    // Emit real-time notification socket event
    const io = getIO();
    if (io) {
      const noticePayload = {
        subject: subject.trim(),
        body,
        target,
        class_level: target === 'class' ? cleanClassLevel : 'Personal',
        timestamp: new Date()
      };
      if (target === 'class' && cleanClassLevel) {
        io.to(cleanClassLevel).emit('new_notice', noticePayload);
      } else if (target === 'student' && recipients[0]) {
        io.to(`USER_${recipients[0]._id}`).emit('new_notice', noticePayload);
      }
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
