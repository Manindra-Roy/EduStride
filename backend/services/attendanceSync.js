import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import Timetable from '../models/Timetable.js';
import { getIO } from '../config/socket.js';

const DAYS_OF_WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Broadcast real-time attendance update event over Socket.IO so ClassGrid,
 * Dashboard (Admin/Teacher/Student), and Gate Scanner update live without refresh.
 */
export const emitAttendanceUpdated = ({ class_level, date, session_name, student_id = null, student_name = '', source = 'manual' }) => {
  try {
    const io = getIO();
    if (!io || !class_level) return;
    const cleanClass = String(class_level).trim();
    const upperClass = cleanClass.toUpperCase();
    const payload = {
      class_level: cleanClass,
      date,
      session_name: session_name || 'Session 1',
      student_id: student_id ? String(student_id) : null,
      student_name,
      source,
      timestamp: new Date()
    };
    const emitter = io.to(cleanClass).to(upperClass).to('GATE_MONITOR');
    if (student_id) {
      emitter.to(`USER_${student_id}`);
    }
    emitter.emit('attendance_updated', payload);
  } catch (err) {
    console.error('[Socket Attendance Emit Error]:', err.message);
  }
};

/**
 * Get current date/time parts in IST (Asia/Kolkata, UTC+5:30).
 */
export const getISTParts = (dateObj = new Date()) => {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(dateObj.getTime() + istOffsetMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  const hours24 = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const dateStr = `${year}-${month}-${day}`;
  const monthStr = `${year}-${month}`;
  const dayOfWeekName = DAYS_OF_WEEK_NAMES[ist.getUTCDay()];

  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  const time12Str = `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
  const time24Str = `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return {
    dateStr,
    monthStr,
    dayOfWeekName,
    hours24,
    minutes,
    totalMinutes: hours24 * 60 + minutes,
    time12Str,
    time24Str
  };
};

/**
 * Parse timetable slot time strings like "09:00", "09:00 AM - 10:00 AM", "16:30 - 17:30", "4:00 PM"
 * into start minutes from midnight (0..1439). Returns null if unparseable.
 */
export const parseSlotStartMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
};

/**
 * Recalculate dynamic merit-based roll numbers for a class level.
 */
export const recalculateRollNumbers = async (class_level) => {
  try {
    const students = await Student.find({ class_level });
    if (students.length === 0) return;

    const studentsWithProgress = students.map(student => {
      let totalMarksObtained = 0;
      let totalMarksPossible = 0;

      if (student.test_scores && student.test_scores.length > 0) {
        student.test_scores.forEach(score => {
          totalMarksObtained += score.marks_obtained;
          totalMarksPossible += score.total_marks;
        });
      }

      const testScorePercentage = totalMarksPossible > 0
        ? (totalMarksObtained / totalMarksPossible) * 100
        : 0;

      let totalClasses = 0;
      let totalAttended = 0;
      if (student.attendance_history && student.attendance_history.length > 0) {
        student.attendance_history.forEach(att => {
          totalClasses += att.total_classes;
          totalAttended += att.attended;
        });
      }
      const attendancePercentage = totalClasses > 0
        ? (totalAttended / totalClasses) * 100
        : 0;

      let progressScore = 0;
      if (totalMarksPossible > 0) {
        progressScore = (testScorePercentage * 0.8) + (attendancePercentage * 0.2);
      } else if (totalClasses > 0) {
        progressScore = attendancePercentage;
      }

      return {
        _id: student._id,
        status: student.status || 'Active',
        progressScore,
        testScorePercentage,
        attendancePercentage,
        joining_date: student.joining_date || new Date(),
        name: student.name
      };
    });

    studentsWithProgress.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'Active' ? -1 : 1;
      }
      if (b.progressScore !== a.progressScore) {
        return b.progressScore - a.progressScore;
      }
      if (b.testScorePercentage !== a.testScorePercentage) {
        return b.testScorePercentage - a.testScorePercentage;
      }
      if (b.attendancePercentage !== a.attendancePercentage) {
        return b.attendancePercentage - a.attendancePercentage;
      }
      const timeA = a.joining_date ? new Date(a.joining_date).getTime() : 0;
      const timeB = b.joining_date ? new Date(b.joining_date).getTime() : 0;
      const validA = isNaN(timeA) ? 0 : timeA;
      const validB = isNaN(timeB) ? 0 : timeB;
      if (validA !== validB) {
        return validA - validB;
      }
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < studentsWithProgress.length; i++) {
      const tempRoll = `TEMP_${Date.now()}_${studentsWithProgress[i]._id}`;
      await Student.findByIdAndUpdate(studentsWithProgress[i]._id, { roll_number: tempRoll });
    }

    for (let i = 0; i < studentsWithProgress.length; i++) {
      const finalRoll = (i + 1).toString().padStart(2, '0');
      await Student.findByIdAndUpdate(studentsWithProgress[i]._id, { roll_number: finalRoll });
    }
  } catch (error) {
    console.error(`Error recalculating roll numbers for class ${class_level}:`, error);
  }
};

/**
 * Recalculate monthly attendance_history for all active students in a class for YYYY-MM.
 */
export const recalculateMonthlyAttendance = async (class_level, trackingMonth) => {
  const studentsInClass = await Student.find({ class_level, status: 'Active' });

  const startOfMonth = new Date(`${trackingMonth}-01T00:00:00.000Z`);
  const year = parseInt(trackingMonth.split('-')[0], 10);
  const month = parseInt(trackingMonth.split('-')[1], 10);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonthVal = month === 12 ? 1 : month + 1;
  const nextMonthStr = nextMonthVal < 10 ? `0${nextMonthVal}` : `${nextMonthVal}`;
  const endOfMonth = new Date(`${nextMonthYear}-${nextMonthStr}-01T00:00:00.000Z`);

  const monthlySheets = await Attendance.find({
    class_level,
    date: {
      $gte: startOfMonth,
      $lt: endOfMonth
    }
  });

  const updatePromises = studentsInClass.map(async (student) => {
    let total_classes = 0;
    let attended = 0;

    monthlySheets.forEach(sheet => {
      const studentRecord = sheet.records.find(r => r.student.toString() === student._id.toString());
      if (studentRecord) {
        total_classes++;
        if (studentRecord.status === 'Present' || studentRecord.status === 'Late') {
          attended++;
        }
      }
    });

    return Student.findOneAndUpdate(
      {
        _id: student._id,
        'attendance_history.month': trackingMonth
      },
      {
        $set: {
          'attendance_history.$.total_classes': total_classes,
          'attendance_history.$.attended': attended
        }
      }
    ).then(async (result) => {
      if (!result) {
        return Student.findByIdAndUpdate(
          student._id,
          {
            $push: {
              attendance_history: {
                month: trackingMonth,
                total_classes,
                attended
              }
            }
          }
        );
      }
      return result;
    });
  });

  await Promise.all(updatePromises);
  await recalculateRollNumbers(class_level);
};

/**
 * Determine which session_name in today's Timetable matches a biometric scan.
 * Matches within ±45 minutes of a scheduled slot start, or falls back to the single slot of the day,
 * or 'Session 1' if no slot matches.
 */
export const resolveActiveSessionForClass = async (class_level, dateStr, istMinutesNow, sessionOverride = '') => {
  if (sessionOverride && sessionOverride.trim()) {
    return sessionOverride.trim();
  }

  try {
    const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
    const dayOfWeekName = DAYS_OF_WEEK_NAMES[normalizedDate.getUTCDay()];
    const timetableDoc = await Timetable.findOne();

    if (timetableDoc && Array.isArray(timetableDoc.data)) {
      const dayData = timetableDoc.data.find(d => d.day && d.day.toLowerCase() === dayOfWeekName.toLowerCase());
      if (dayData && Array.isArray(dayData.slots)) {
        const classSlots = dayData.slots.filter(
          s => s.grade && s.grade.trim().toUpperCase() === class_level.trim().toUpperCase()
        );

        if (classSlots.length === 1) {
          const only = classSlots[0];
          return `${only.time} - ${only.subject}`;
        }

        if (classSlots.length > 1) {
          let bestSlot = null;
          let bestDiff = Infinity;
          for (const slot of classSlots) {
            const startMins = parseSlotStartMinutes(slot.time);
            if (startMins !== null) {
              const diff = Math.abs(istMinutesNow - startMins);
              if (diff <= 45 && diff < bestDiff) {
                bestDiff = diff;
                bestSlot = slot;
              }
            }
          }
          if (bestSlot) {
            return `${bestSlot.time} - ${bestSlot.subject}`;
          }
          // Fallback to first scheduled slot if none within 45 min
          return `${classSlots[0].time} - ${classSlots[0].subject}`;
        }
      }
    }
  } catch (err) {
    console.error('[Biometric Attendance Session Resolve Error]:', err.message);
  }

  return 'Session 1';
};

/**
 * Automatically mark a scanned student as Present in the existing Attendance collection,
 * preserving all classmates' existing manual statuses and syncing monthly attendance + roll numbers.
 */
export const markBiometricAttendancePresent = async (student, dateStr, time12Str, istMinutesNow, sessionOverride = '') => {
  const class_level = student.class_level;
  const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
  const trackingMonth = dateStr.substring(0, 7);
  const session_name = await resolveActiveSessionForClass(class_level, dateStr, istMinutesNow, sessionOverride);

  let sheet = await Attendance.findOne({ class_level, date: normalizedDate, session_name });
  const entryRemark = `Biometric Entry ${time12Str}`;

  if (!sheet) {
    // First student of this class for this session today: initialize sheet with all active classmates
    const activeStudents = await Student.find({ class_level, status: 'Active' }).select('_id');
    const records = activeStudents.map(s => ({
      student: s._id,
      status: s._id.toString() === student._id.toString() ? 'Present' : 'Absent',
      remarks: s._id.toString() === student._id.toString() ? entryRemark : ''
    }));

    // Ensure scanned student is included even if status changed
    if (!records.some(r => r.student.toString() === student._id.toString())) {
      records.push({
        student: student._id,
        status: 'Present',
        remarks: entryRemark
      });
    }

    sheet = await Attendance.create({
      class_level,
      date: normalizedDate,
      session_name,
      records
    });
  } else {
    // Sheet already exists (biometric or manual): update ONLY this student without overwriting anyone else
    const existingRec = sheet.records.find(r => r.student.toString() === student._id.toString());
    if (existingRec) {
      existingRec.status = 'Present';
      existingRec.remarks = existingRec.remarks
        ? (existingRec.remarks.includes('Biometric Entry') ? existingRec.remarks : `${existingRec.remarks} | ${entryRemark}`)
        : entryRemark;
    } else {
      sheet.records.push({
        student: student._id,
        status: 'Present',
        remarks: entryRemark
      });
    }
    await sheet.save();
  }

  await recalculateMonthlyAttendance(class_level, trackingMonth);

  emitAttendanceUpdated({
    class_level,
    date: dateStr,
    session_name,
    student_id: student._id,
    student_name: student.name,
    source: 'biometric'
  });

  return { session_name, marked: true };
};

/**
 * Append biometric exit time into today's Attendance record remark (keeps status 'Present' intact).
 */
export const appendBiometricExitRemark = async (student, dateStr, time12Str, sessionName) => {
  try {
    const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
    const query = sessionName
      ? { class_level: student.class_level, date: normalizedDate, session_name: sessionName }
      : { class_level: student.class_level, date: normalizedDate };

    const sheet = await Attendance.findOne(query).sort({ updatedAt: -1 });
    if (!sheet) return;

    const existingRec = sheet.records.find(r => r.student.toString() === student._id.toString());
    if (existingRec) {
      const exitNote = `Exit ${time12Str}`;
      existingRec.remarks = existingRec.remarks ? `${existingRec.remarks} | ${exitNote}` : exitNote;
      await sheet.save();

      emitAttendanceUpdated({
        class_level: student.class_level,
        date: dateStr,
        session_name: sheet.session_name,
        student_id: student._id,
        student_name: student.name,
        source: 'biometric_exit'
      });
    }
  } catch (err) {
    console.error('[Biometric Exit Remark Error]:', err.message);
  }
};
