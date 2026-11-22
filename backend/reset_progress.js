import 'dotenv/config';
import mongoose from 'mongoose';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run reset_progress.js when NODE_ENV=production.');
  process.exit(1);
}

if (!process.argv.includes('--confirm-wipe')) {
  console.error('Refusing to wipe progress data without explicit --confirm-wipe flag.');
  console.error('Usage: node reset_progress.js --confirm-wipe');
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI environment variable is required.');
  process.exit(1);
}

console.log('Connecting to MongoDB...');

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected successfully!');

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

    // 2. Clear all Daily Attendance logs
    console.log('Clearing daily Attendance registers...');
    const attendanceDeleteResult = await mongoose.connection.collection('attendances').deleteMany({});
    console.log(`Deleted ${attendanceDeleteResult.deletedCount} daily Attendance logs.`);

    // 3. Reset all Fee Ledgers to default unpaid months
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

    const ledgerUpdateResult = await mongoose.connection.collection('feeledgers').updateMany(
      {},
      {
        $set: {
          months: defaultMonths,
          year: new Date().getFullYear()
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
