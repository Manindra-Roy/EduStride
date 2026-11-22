import User from '../models/User.js';
import GateEntryLog from '../models/GateEntryLog.js';
import { sendEmail } from './mailService.js';
import { getIO } from '../config/socket.js';
import { escapeHtml } from '../utils/html.js';

const formatDuration = (mins) => {
  if (mins === null || mins === undefined || mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
};

/**
 * Dispatches instant Entry/Exit parent notifications (Mobile App Push via Socket.IO,
 * Parent Email via Brevo/SMTP, WhatsApp quick-send URL, and optional SMS/WA webhook).
 * Updates the GateEntryLog notification status in DB and emits live gate_scan_event to GATE_MONITOR.
 */
export const dispatchGateNotification = async ({ logDoc, student, time12Str, dateStr, sendParentAlerts = true }) => {
  const isEntry = logDoc.event_type === 'ENTRY';
  const actionWord = isEntry ? 'Entered' : 'Exited';
  const durationLabel = !isEntry && logDoc.duration_minutes !== null
    ? ` (Duration: ${formatDuration(logDoc.duration_minutes)})`
    : '';

  const parentName = student.parent_name || 'Parent / Guardian';
  const subject = isEntry
    ? `Campus Entry Alert: ${student.name} arrived at ${time12Str}`
    : `Campus Exit Alert: ${student.name} departed at ${time12Str}`;

  const plainMessage = isEntry
    ? `Dear ${parentName}, your ward ${student.name} (Class ${student.class_level}, Roll ${student.roll_number}) ENTERED the institute at ${time12Str} on ${dateStr}.`
    : `Dear ${parentName}, your ward ${student.name} (Class ${student.class_level}, Roll ${student.roll_number}) EXITED the institute at ${time12Str} on ${dateStr}${durationLabel}.`;

  // 1. Build 1-tap WhatsApp URL for primary_contact (always available for manual follow-up)
  let whatsappLink = '';
  if (student.primary_contact) {
    const numericPhone = String(student.primary_contact).replace(/\D/g, '');
    if (numericPhone.length >= 10) {
      const formattedPhone = numericPhone.startsWith('91') || numericPhone.length > 10
        ? numericPhone
        : `91${numericPhone}`;
      whatsappLink = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(plainMessage)}`;
    }
  }

  let pushSent = false;
  let emailSent = false;
  let emailTo = '';
  let emailError = '';
  let smsSent = false;

  const io = getIO();

  // If parent alerts are paused in the app, skip Push/Email/SMS dispatch but still update live admin feed
  if (!sendParentAlerts) {
    const pausedLog = await GateEntryLog.findByIdAndUpdate(
      logDoc._id,
      {
        notification: {
          paused: true,
          email_sent: false,
          email_to: '',
          email_error: 'Parent alerts paused',
          push_sent: false,
          sms_sent: false,
          whatsapp_link: whatsappLink
        }
      },
      { new: true }
    ).populate('student', 'name roll_number class_level parent_name primary_contact');

    if (io && pausedLog) {
      io.to('GATE_MONITOR').to(`USER_${student._id}`).emit('gate_scan_event', pausedLog);
    }
    return pausedLog;
  }

  // 2. Instant Mobile App / Web Push Notification via Socket.IO
  if (io) {
    const userRoom = `USER_${student._id}`;
    const hasConnectedClient = (io.sockets?.adapter?.rooms?.get(userRoom)?.size || 0) > 0;
    const noticePayload = {
      subject,
      body: plainMessage,
      target: 'student',
      class_level: 'Personal',
      event_type: logDoc.event_type,
      timestamp: logDoc.timestamp
    };
    io.to(userRoom).emit('new_notice', noticePayload);
    pushSent = hasConnectedClient;
  }

  // 3. Instant Parent Email via existing mailService (Brevo in prod / SMTP in dev)
  try {
    const dedicatedParentEmail = student.parent_email && student.parent_email.includes('@')
      ? student.parent_email.trim()
      : '';
    const studentUser = dedicatedParentEmail ? null : await User.findOne({ studentProfile: student._id });
    emailTo = dedicatedParentEmail
      || studentUser?.email
      || (student.primary_contact && student.primary_contact.includes('@') ? student.primary_contact.trim() : '');

    if (emailTo) {
      const accentColor = isEntry ? '#10b981' : '#f59e0b';
      const badgeLabel = isEntry ? 'CAMPUS ENTRY' : 'CAMPUS EXIT';

      const safeParentName = escapeHtml(parentName);
      const safeStudentName = escapeHtml(student.name);
      const safeClassLevel = escapeHtml(student.class_level);
      const safeRollNumber = escapeHtml(student.roll_number);
      const safeActionWord = escapeHtml(actionWord);
      const safeEventType = escapeHtml(logDoc.event_type);
      const safeTime = escapeHtml(time12Str);
      const safeDate = escapeHtml(dateStr);
      const safeDuration = escapeHtml(formatDuration(logDoc.duration_minutes));

      await sendEmail({
        from: '"EduStride Gate Security" <admin@edustride.com>',
        to: emailTo,
        subject,
        text: `${plainMessage}\n\nMonitor live attendance & schedules at https://edustride.in\n\nBest regards,\nEduStride Administration`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; border-bottom: 2px solid ${accentColor}; padding-bottom: 14px; margin-bottom: 18px;">
              <span style="display: inline-block; padding: 4px 12px; border-radius: 999px; background-color: ${accentColor}; color: #ffffff; font-size: 11px; font-weight: bold; letter-spacing: 1px;">${badgeLabel}</span>
              <h2 style="color: #1e293b; margin: 10px 0 0 0; font-size: 20px;">EduStride Biometric Gate Alert</h2>
            </div>

            <p style="font-size: 14px; margin: 0 0 12px 0;">Dear <strong>${safeParentName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">
              This is an automated biometric notification confirming that <strong>${safeStudentName}</strong> has <strong>${safeActionWord}</strong> the campus.
            </p>

            <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 10px; overflow: hidden; font-size: 13px; margin-bottom: 18px;">
              <tr>
                <td style="padding: 10px 14px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Student</td>
                <td style="padding: 10px 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${safeStudentName} (Class ${safeClassLevel}, Roll ${safeRollNumber})</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Event</td>
                <td style="padding: 10px 14px; font-weight: bold; color: ${accentColor}; border-bottom: 1px solid #e2e8f0;">${safeEventType}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Date &amp; Time (IST)</td>
                <td style="padding: 10px 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${safeTime} &bull; ${safeDate}</td>
              </tr>
              ${!isEntry && logDoc.duration_minutes !== null ? `
              <tr>
                <td style="padding: 10px 14px; color: #64748b;">Campus Duration</td>
                <td style="padding: 10px 14px; font-weight: bold; color: #0f172a;">${safeDuration}</td>
              </tr>` : ''}
            </table>

            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
              Automated alert from <a href="https://edustride.in" style="color: #4f46e5; text-decoration: none; font-weight: bold;">EduStride.in</a> Biometric Gate System.
            </p>
          </div>
        `
      });
      emailSent = true;
    } else {
      emailError = 'No linked email address';
    }
  } catch (err) {
    emailError = err.message || 'Email dispatch failed';
    console.error(`[Gate Notifier] Email failed for ${student.name}:`, err.message);
  }

  // 4. Optional Automated SMS / WhatsApp Webhook (plug-and-play via .env)
  if (process.env.GATE_SMS_WEBHOOK_URL && student.primary_contact) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.GATE_SMS_WEBHOOK_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.GATE_SMS_WEBHOOK_TOKEN}`;
      }
      const resp = await fetch(process.env.GATE_SMS_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          phone: student.primary_contact,
          parent_name: parentName,
          student_name: student.name,
          class_level: student.class_level,
          roll_number: student.roll_number,
          event_type: logDoc.event_type,
          time: time12Str,
          date: dateStr,
          duration_minutes: logDoc.duration_minutes,
          message: plainMessage
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) smsSent = true;
    } catch (err) {
      console.error('[Gate Notifier] Optional SMS/WA webhook failed:', err.message);
    }
  }

  // 5. Persist notification delivery statuses & broadcast enriched live scan event to GATE_MONITOR
  const updatedLog = await GateEntryLog.findByIdAndUpdate(
    logDoc._id,
    {
      notification: {
        paused: false,
        email_sent: emailSent,
        email_to: emailTo,
        email_error: emailError,
        push_sent: pushSent,
        sms_sent: smsSent,
        whatsapp_link: whatsappLink
      }
    },
    { new: true }
  ).populate('student', 'name roll_number class_level parent_name primary_contact');

  if (io && updatedLog) {
    io.to('GATE_MONITOR').to(`USER_${student._id}`).emit('gate_scan_event', updatedLog);
  }

  return updatedLog;
};
