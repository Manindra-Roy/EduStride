import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://anonymoussecretin_db_user:kbH4cbqG9Zu4fIv9@cluster0.sllnvku.mongodb.net/student_erp";

console.log("Connecting to MongoDB...");

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log("Connected successfully!");

    // 1. Reset Student progress history and score arrays
    console.log("Resetting Student progress records...");
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
    console.log("Clearing daily Attendance registers...");
    const attendanceDeleteResult = await mongoose.connection.collection('attendances').deleteMany({});
    console.log(`Deleted ${attendanceDeleteResult.deletedCount} daily Attendance logs.`);

    // 3. Reset all Fee Ledgers to default unpaid months
    console.log("Resetting Fee Ledgers to default unpaid state...");
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

    console.log("Database reset complete! All progress data has been wiped while preserving Student IDs and credentials.");
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Database connection failure:", err);
    process.exit(1);
  });
