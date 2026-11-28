import mongoose from 'mongoose';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import Timetable from '../models/Timetable.js';
import { getIO } from '../config/socket.js';

const DAYS_OF_WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Short-TTL in-memory Timetable cache to avoid re-querying MongoDB on every biometric scan
let cachedTimetableData = null;
let cachedTimetableExpiresAt = 0;
const TIMETABLE_CACHE_TTL_MS = 60000;

export const invalidateTimetableCache = () => {
  cachedTimetableData = null;
  cachedTimetableExpiresAt = 0;
};

const getCachedTimetableData = async () => {
  const now = Date.now();
  if (cachedTimetableData !== null && now < cachedTimetableExpiresAt) {
    return cachedTimetableData;
  }
  const timetableDoc = await Timetable.findOne().select('data').lean();
  cachedTimetableData = Array.isArray(timetableDoc?.data) ? timetableDoc.data : [];
  cachedTimetableExpiresAt = now + TIMETABLE_CACHE_TTL_MS;
  return cachedTimetableData;
};

// Generic keyed async mutex for serializing Attendance sheet mutations across manual & biometric paths
const sheetLocks = new Map();
export const makeSheetLockKey = (class_level, dateStr, session_name) =>
  `${String(class_level || '').trim().toUpperCase()}::${String(dateStr || '').trim()}::${String(session_name || 'Session 1').trim()}`;

export const withSheetLock = async (key, fn) => {
  const prev = sheetLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const chained = prev.catch(() => {}).then(() => next);
  sheetLocks.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (sheetLocks.get(key) === chained) {
      sheetLocks.delete(key);
    }
  }
};

/**
 * Broadcast real-time attendance update event over Socket.IO so ClassGrid,
 * Dashboard (Admin/Teacher/Student), and Gate Scanner update live without refresh.
 */
export const emitAttendanceUpdated = ({
  class_level,
  date,
  session_name,
  student_id = null,
  student_ids = null,
  student_name = '',
  source = 'manual'
}) => {
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
    let emitter = io.to(cleanClass).to(upperClass).to('GATE_MONITOR');
    if (Array.isArray(student_ids) && student_ids.length > 0) {
      for (const sid of student_ids) {
        if (sid) emitter = emitter.to(`USER_${sid}`);
      }
    } else if (student_id) {
      emitter = emitter.to(`USER_${student_id}`);
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
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  let meridiem = match[3] ? match[3].toUpperCase() : null;

  // Handle ranges like "04:00 - 05:00 PM" where meridiem is written only at the end
  if (!meridiem && hours >= 1 && hours <= 12) {
    const endMatch = trimmed.match(/-\s*(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
    if (endMatch) {
      const endHour = parseInt(endMatch[1], 10);
      const endMeridiem = endMatch[3].toUpperCase();
      if (hours <= endHour || endHour === 12) {
        meridiem = endMeridiem;
      } else {
        meridiem = endMeridiem === 'PM' ? 'AM' : 'PM';
      }
    }
  }

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
};

// Per-class serialization + coalescing for roll number recalculation
// Prevents concurrent rush-hour biometric scans from colliding on the unique { class_level, roll_number } index.
const rollRecalcActive = new Map(); // class_level -> Promise
const rollRecalcDirty = new Set();  // class_level needing one more pass after active finishes

const runRecalculateRollNumbers = async (class_level) => {
  const students = await Student.find({ class_level })
    .select('_id roll_number status test_scores attendance_history joining_date name')
    .lean();
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
      roll_number: student.roll_number || '',
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

  // Skip database writes entirely if every student already holds their exact target roll number!
  const needsUpdate = studentsWithProgress.some((s, idx) => {
    const targetRoll = (idx + 1).toString().padStart(2, '0');
    return s.roll_number !== targetRoll;
  });
  if (!needsUpdate) return;

  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempOps = studentsWithProgress.map(s => ({
    updateOne: {
      filter: { _id: s._id },
      update: { $set: { roll_number: `TEMP_${nonce}_${s._id}` } }
    }
  }));
  const finalOps = studentsWithProgress.map((s, idx) => ({
    updateOne: {
      filter: { _id: s._id },
      update: { $set: { roll_number: (idx + 1).toString().padStart(2, '0') } }
    }
  }));

  // Use a MongoDB transaction on replica sets (Atlas) so readers NEVER observe TEMP_ roll numbers
  let session = null;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Student.bulkWrite(tempOps, { ordered: true, session });
      await Student.bulkWrite(finalOps, { ordered: true, session });
    });
  } catch (txErr) {
    const isStandaloneUnsupported =
      txErr?.code === 20 ||
      /Transaction numbers are only allowed on a replica set/i.test(txErr?.message || '');
    if (!isStandaloneUnsupported) {
      throw txErr;
    }
    // Standalone local MongoDB fallback: execute two-pass update with retry on finalOps so TEMP_ never persists
    await Student.bulkWrite(tempOps, { ordered: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await Student.bulkWrite(finalOps, { ordered: true });
        break;
      } catch (finalErr) {
        if (attempt === 2) throw finalErr;
      }
    }
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
  }
};

/**
 * Recalculate dynamic merit-based roll numbers for a class level (serialized per class).
 */
export const recalculateRollNumbers = async (class_level) => {
  if (!class_level) return;
  const key = String(class_level).trim().toUpperCase();

  if (rollRecalcActive.has(key)) {
    rollRecalcDirty.add(key);
    return rollRecalcActive.get(key);
  }

  const job = (async () => {
    try {
      do {
        rollRecalcDirty.delete(key);
        await runRecalculateRollNumbers(class_level);
      } while (rollRecalcDirty.has(key));
    } catch (error) {
      console.error(`Error recalculating roll numbers for class ${class_level}:`, error);
    } finally {
      rollRecalcActive.delete(key);
    }
  })();

  rollRecalcActive.set(key, job);
  return job;
};

// Per-(class_level, trackingMonth) serialization + coalescing for monthly attendance aggregation
const monthlyRecalcActive = new Map();
const monthlyRecalcDirty = new Set();

const runRecalculateMonthlyAttendance = async (class_level, trackingMonth) => {
  const startOfMonth = new Date(`${trackingMonth}-01T00:00:00.000Z`);
  const year = parseInt(trackingMonth.split('-')[0], 10);
  const month = parseInt(trackingMonth.split('-')[1], 10);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonthVal = month === 12 ? 1 : month + 1;
  const nextMonthStr = nextMonthVal < 10 ? `0${nextMonthVal}` : `${nextMonthVal}`;
  const endOfMonth = new Date(`${nextMonthYear}-${nextMonthStr}-01T00:00:00.000Z`);

  const [studentsInClass, monthlySheets] = await Promise.all([
    Student.find({ class_level, status: 'Active' })
      .select('_id attendance_history.month')
      .lean(),
    Attendance.find({
      class_level,
      date: {
        $gte: startOfMonth,
        $lt: endOfMonth
      }
    })
      .select('records.student records.status')
      .lean()
  ]);

  if (studentsInClass.length === 0) return;

  // Tally monthly attendance counts in O(sheets * records) with a Map instead of nested .find()
  const countsByStudent = new Map();
  for (const sheet of monthlySheets) {
    if (!Array.isArray(sheet.records)) continue;
    for (const rec of sheet.records) {
      if (!rec.student) continue;
      const sid = rec.student.toString();
      let entry = countsByStudent.get(sid);
      if (!entry) {
        entry = { total_classes: 0, attended: 0 };
        countsByStudent.set(sid, entry);
      }
      entry.total_classes++;
      if (rec.status === 'Present' || rec.status === 'Late') {
        entry.attended++;
      }
    }
  }

  const bulkOps = [];
  for (const student of studentsInClass) {
    const sid = student._id.toString();
    const tally = countsByStudent.get(sid) || { total_classes: 0, attended: 0 };
    const hasMonth = Array.isArray(student.attendance_history)
      && student.attendance_history.some(h => h.month === trackingMonth);

    if (hasMonth) {
      bulkOps.push({
        updateOne: {
          filter: { _id: student._id, 'attendance_history.month': trackingMonth },
          update: {
            $set: {
              'attendance_history.$.total_classes': tally.total_classes,
              'attendance_history.$.attended': tally.attended
            }
          }
        }
      });
    } else {
      // Guard $push with $ne so concurrent writers can never push duplicate month entries
      bulkOps.push({
        updateOne: {
          filter: { _id: student._id, 'attendance_history.month': { $ne: trackingMonth } },
          update: {
            $push: {
              attendance_history: {
                month: trackingMonth,
                total_classes: tally.total_classes,
                attended: tally.attended
              }
            }
          }
        }
      });
    }
  }

  if (bulkOps.length > 0) {
    await Student.bulkWrite(bulkOps, { ordered: false });
  }
  await recalculateRollNumbers(class_level);
};

/**
 * Recalculate monthly attendance_history for all active students in a class for YYYY-MM
 * serialized per (class_level, trackingMonth).
 */
export const recalculateMonthlyAttendance = async (class_level, trackingMonth) => {
  if (!class_level || !trackingMonth) return;
  const key = `${String(class_level).trim().toUpperCase()}::${trackingMonth}`;

  if (monthlyRecalcActive.has(key)) {
    monthlyRecalcDirty.add(key);
    return monthlyRecalcActive.get(key);
  }

  const job = (async () => {
    try {
      do {
        monthlyRecalcDirty.delete(key);
        await runRecalculateMonthlyAttendance(class_level, trackingMonth);
      } while (monthlyRecalcDirty.has(key));
    } catch (error) {
      console.error(`Error recalculating monthly attendance for ${key}:`, error);
    } finally {
      monthlyRecalcActive.delete(key);
    }
  })();

  monthlyRecalcActive.set(key, job);
  return job;
};

// Debounced per-(class_level, month) background recalculation so ESP32 gate scans respond in ~100ms
// and burst arrivals coalesce into a single DB recalculation while notifying ALL scanned students.
const biometricRecalcState = new Map(); // key -> { timer, studentIds: Set<string>, lastMeta }

const scheduleBiometricPostSync = ({ class_level, trackingMonth, dateStr, session_name, student_id, student_name }) => {
  const key = `${String(class_level).trim().toUpperCase()}::${trackingMonth}`;
  let entry = biometricRecalcState.get(key);
  if (!entry) {
    entry = { timer: null, studentIds: new Set(), lastMeta: null };
    biometricRecalcState.set(key, entry);
  }
  if (student_id) {
    entry.studentIds.add(String(student_id));
  }
  entry.lastMeta = { class_level, trackingMonth, dateStr, session_name, student_id, student_name };

  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  entry.timer = setTimeout(async () => {
    const current = biometricRecalcState.get(key);
    biometricRecalcState.delete(key);
    if (!current || !current.lastMeta) return;
    const meta = current.lastMeta;
    const allStudentIds = Array.from(current.studentIds);
    try {
      await recalculateMonthlyAttendance(meta.class_level, meta.trackingMonth);
      emitAttendanceUpdated({
        class_level: meta.class_level,
        date: meta.dateStr,
        session_name: meta.session_name,
        student_id: meta.student_id,
        student_ids: allStudentIds,
        student_name: meta.student_name,
        source: 'biometric'
      });
    } catch (err) {
      console.error('[Biometric Post-Sync Error]:', err.message);
    }
  }, 450);
};

/**
 * Determine which session_name in today's Timetable matches a biometric scan.
 * Matches within ±45 minutes of a scheduled slot start, or falls back to the nearest slot
 * by time distance, or 'Session 1' if no slot exists.
 */
export const resolveActiveSessionForClass = async (class_level, dateStr, istMinutesNow, sessionOverride = '') => {
  if (sessionOverride && sessionOverride.trim()) {
    return sessionOverride.trim();
  }

  try {
    const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
    const dayOfWeekName = DAYS_OF_WEEK_NAMES[normalizedDate.getUTCDay()];
    const timetableData = await getCachedTimetableData();

    if (timetableData.length > 0) {
      const dayData = timetableData.find(d => d.day && d.day.toLowerCase() === dayOfWeekName.toLowerCase());
      if (dayData && Array.isArray(dayData.slots)) {
        const classSlots = dayData.slots.filter(
          s => s.grade && s.grade.trim().toUpperCase() === class_level.trim().toUpperCase()
        );

        if (classSlots.length === 1) {
          const only = classSlots[0];
          return `${only.time} - ${only.subject}`;
        }

        if (classSlots.length > 1) {
          let bestWindowSlot = null;
          let bestWindowDiff = Infinity;
          let nearestSlot = null;
          let nearestDiff = Infinity;

          for (const slot of classSlots) {
            const startMins = parseSlotStartMinutes(slot.time);
            if (startMins !== null) {
              const diff = Math.abs(istMinutesNow - startMins);
              if (diff < nearestDiff) {
                nearestDiff = diff;
                nearestSlot = slot;
              }
              if (diff <= 45 && diff < bestWindowDiff) {
                bestWindowDiff = diff;
                bestWindowSlot = slot;
              }
            }
          }
          if (bestWindowSlot) {
            return `${bestWindowSlot.time} - ${bestWindowSlot.subject}`;
          }
          if (nearestSlot) {
            return `${nearestSlot.time} - ${nearestSlot.subject}`;
          }
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
 * serialized per (class_level, dateStr, session_name) with E11000 retry protection.
 */
export const markBiometricAttendancePresent = async (student, dateStr, time12Str, istMinutesNow, sessionOverride = '') => {
  const class_level = student.class_level;
  const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
  const trackingMonth = dateStr.substring(0, 7);
  const session_name = await resolveActiveSessionForClass(class_level, dateStr, istMinutesNow, sessionOverride);
  const lockKey = makeSheetLockKey(class_level, dateStr, session_name);

  await withSheetLock(lockKey, async () => {
    const entryRemark = `Biometric Entry ${time12Str}`;

    const applyUpdateToSheet = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const currentSheet = await Attendance.findOne({ class_level, date: normalizedDate, session_name });
        if (!currentSheet) return false;

        const existingRec = currentSheet.records.find(r => r.student.toString() === student._id.toString());
        if (existingRec) {
          existingRec.status = 'Present';
          existingRec.remarks = existingRec.remarks
            ? (existingRec.remarks.includes('Biometric Entry') ? existingRec.remarks : `${existingRec.remarks} | ${entryRemark}`)
            : entryRemark;
        } else {
          currentSheet.records.push({
            student: student._id,
            status: 'Present',
            remarks: entryRemark
          });
        }
        try {
          await currentSheet.save();
          return true;
        } catch (saveErr) {
          if (saveErr?.name === 'VersionError' && attempt < 2) continue;
          throw saveErr;
        }
      }
      return false;
    };

    const updatedExisting = await applyUpdateToSheet();

    if (!updatedExisting) {
      const activeStudents = await Student.find({ class_level, status: 'Active' }).select('_id').lean();
      const records = activeStudents.map(s => ({
        student: s._id,
        status: s._id.toString() === student._id.toString() ? 'Present' : 'Absent',
        remarks: s._id.toString() === student._id.toString() ? entryRemark : ''
      }));

      if (!records.some(r => r.student.toString() === student._id.toString())) {
        records.push({
          student: student._id,
          status: 'Present',
          remarks: entryRemark
        });
      }

      try {
        await Attendance.create({
          class_level,
          date: normalizedDate,
          session_name,
          records
        });
      } catch (createErr) {
        // Handle E11000 duplicate-key race (e.g. concurrent teacher manual sheet save)
        if (createErr?.code === 11000) {
          await applyUpdateToSheet();
        } else {
          throw createErr;
        }
      }
    }
  });

  scheduleBiometricPostSync({
    class_level,
    trackingMonth,
    dateStr,
    session_name,
    student_id: student._id,
    student_name: student.name
  });

  return { session_name, marked: true };
};

/**
 * Append biometric exit time into today's Attendance record remark (keeps status 'Present' intact),
 * serialized with manual and entry updates for the exact same sheet.
 */
export const appendBiometricExitRemark = async (student, dateStr, time12Str, sessionName) => {
  try {
    const normalizedDate = new Date(`${dateStr}T00:00:00.000Z`);
    let resolvedSession = (typeof sessionName === 'string' && sessionName.trim()) ? sessionName.trim() : '';

    // Resolve concrete session_name BEFORE locking so lockKey matches manual & biometric entry locks!
    if (!resolvedSession) {
      const latestSheet = await Attendance.findOne({ class_level: student.class_level, date: normalizedDate })
        .sort({ updatedAt: -1 })
        .select('session_name')
        .lean();
      if (!latestSheet?.session_name) return;
      resolvedSession = latestSheet.session_name;
    }

    const lockKey = makeSheetLockKey(student.class_level, dateStr, resolvedSession);

    await withSheetLock(lockKey, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sheet = await Attendance.findOne({
          class_level: student.class_level,
          date: normalizedDate,
          session_name: resolvedSession
        });
        if (!sheet) return;

        const existingRec = sheet.records.find(r => r.student.toString() === student._id.toString());
        if (!existingRec) return;

        const exitNote = `Exit ${time12Str}`;
        existingRec.remarks = existingRec.remarks ? `${existingRec.remarks} | ${exitNote}` : exitNote;
        try {
          await sheet.save();
          emitAttendanceUpdated({
            class_level: student.class_level,
            date: dateStr,
            session_name: sheet.session_name,
            student_id: student._id,
            student_name: student.name,
            source: 'biometric_exit'
          });
          return;
        } catch (saveErr) {
          if (saveErr?.name === 'VersionError' && attempt < 2) continue;
          throw saveErr;
        }
      }
    });
  } catch (err) {
    console.error('[Biometric Exit Remark Error]:', err.message);
  }
};
