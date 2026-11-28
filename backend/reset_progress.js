import 'dotenv/config';
import mongoose from 'mongoose';

const normalizedEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
if (normalizedEnv === 'production' || normalizedEnv === 'prod') {
  console.error('Refusing to run reset_progress.js in production.');
  process.exit(1);
}

if (!process.argv.includes('--confirm-wipe')) {
  console.error('Refusing to wipe progress data without explicit --confirm-wipe flag.');
  console.error('Usage: node reset_progress.js --confirm-wipe [--allow-remote-db=<dbName>]');
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI environment variable is required.');
  process.exit(1);
}

const isLocalMongo = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i.test(MONGO_URI.trim());
const allowRemoteArg = process.argv.find(a => a.startsWith('--allow-remote-db='));
const allowedRemoteDbName = allowRemoteArg ? allowRemoteArg.split('=')[1]?.trim() : '';

if (!isLocalMongo && !allowedRemoteDbName) {
  console.error('Refusing to wipe a non-localhost / MongoDB Atlas database without --allow-remote-db=<exactDbName>.');
  process.exit(1);
}

console.log('Connecting to MongoDB...');

mongoose.connect(MONGO_URI)
  .then(async () => {
    const dbName = mongoose.connection.name;
    if (!isLocalMongo && allowedRemoteDbName !== dbName) {
      console.error(`Refusing to wipe remote database "${dbName}": --allow-remote-db must exactly match "${dbName}".`);
      await mongoose.connection.close();
      process.exit(1);
    }
    console.log(`Connected successfully to database "${dbName}"!`);

    // 1. Reset Student progress history and score arrays
    console.log('Resetting Student progress records...');
    const studentUpdateResult = await mongoose.connection.collection('students').updateMany(
      {},
      {
        $set: {
          attendance_history: [],
          test_scores: [],
          tuition_test_scores: [],
          academic_history: []
        }
      }
    );
    console.log(`Modified ${studentUpdateResult.modifiedCount} Student profiles.`);

    // 2. Clear all Daily Attendance & Biometric Gate logs + Special Batch progress arrays
    console.log('Clearing daily Attendance registers and Gate Entry logs...');
    const attendanceDeleteResult = await mongoose.connection.collection('attendances').deleteMany({});
    const gateLogDeleteResult = await mongoose.connection.collection('gateentrylogs').deleteMany({});
    const batchUpdateResult = await mongoose.connection.collection('specialbatches').updateMany(
      {},
      { $set: { attendance_records: [], test_scores: [] } }
    );
    console.log(`Deleted ${attendanceDeleteResult.deletedCount} Attendance logs, ${gateLogDeleteResult.deletedCount} GateEntryLogs, and reset ${batchUpdateResult.modifiedCount} SpecialBatches.`);

    // 3. Reset all Fee Ledgers to default unpaid months (IST year)
    console.log('Resetting Fee Ledgers to default unpaid state...');
    const defaultMonths = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ].map(m => ({
      month_name: m,
      status: 'Unpaid',
      amount_paid: 0,
      payment_date: null,
      receipt_id: null,
      transaction_method: null
    }));

    const istYear = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCFullYear();
    const ledgerUpdateResult = await mongoose.connection.collection('feeledgers').updateMany(
      {},
      {
        $set: {
          months: defaultMonths,
          year: istYear
        }
      }
    );
    console.log(`Reset ${ledgerUpdateResult.modifiedCount} Fee Ledgers.`);

    console.log('Database reset complete! All progress data has been wiped while preserving Student IDs and credentials.');
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Database connection failure:', err);
    process.exit(1);
  });
