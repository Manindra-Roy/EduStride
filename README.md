# Institutional ERP & LMS Suite

An enterprise-ready, production-grade Institutional ERP & Learning Management System (LMS) platform for managing student lifecycles, real-time messaging communications, financial tuition ledgers, curriculum progress auditing, and automated background cron notifications.

---

## 🏗️ Folder Structural Blueprint

```text
EduStride/
├── backend/
│   ├── config/
│   │   ├── db.js             # MongoDB connection setup via Mongoose
│   │   └── socket.js         # Socket.io connection handling & event listeners
│   ├── middleware/
│   │   ├── auth.js           # JWT verification & Role-Based Access Control (RBAC)
│   │   └── error.js          # Centralized error mapping and exception handler
│   ├── models/
│   │   ├── User.js           # Auth model (SuperAdmin, Teacher, Student)
│   │   ├── Student.js        # Profile data, attendance history, and test score sub-documents
│   │   ├── FeeLedger.js      # Rolling 12-month payment structures (Paid/Unpaid/Partial)
│   │   ├── StudyMaterial.js  # LMS library handouts meta & curricular status tracking
│   │   └── ChatMessage.js    # Persistent group chat messaging archive
│   ├── routes/
│   │   ├── auth.js           # Credentials auth & student profile linking routers
│   │   ├── students.js       # Student CRUD, Bulk Attendance Logging & Test Score additions
│   │   ├── studyMaterials.js # Multer multipart upload processing & syllabus updates
│   │   └── fees.js           # Tuition metrics aggregator & Mock Webhook gateway endpoint
│   ├── services/
│   │   └── cron.js           # node-cron background fee nags & low-attendance warnings
│   ├── uploads/              # Local disk storage folder for handouts
│   ├── server.js             # Express application root entry point
│   ├── .env                  # Configuration variables
│   └── package.json          # Server-side packages
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Sidebar.jsx   # Premium sidebar navigation layout (responsive)
│   │   ├── context/
│   │   │   └── AuthContext.jsx # Global auth providers (Axios authorization header intercept)
│   │   ├── pages/
│   │   │   ├── Login.jsx     # Dark glassmorphism signing menu
│   │   │   ├── Register.jsx  # Student-linking registration screen
│   │   │   ├── Dashboard.jsx # Analytical dashboards (charts, alerts, progress widgets)
│   │   │   ├── ClassGrid.jsx # Class-level isolated dashboards (attendance matrices, test marks)
│   │   │   ├── FeeLedgerPanel.jsx # Tri-state rolling grids & mock stripe webhook gateway
│   │   │   ├── LmsDownload.jsx  # Curriculum handout downloads & publishing boards
│   │   │   ├── ClassChat.jsx  # WebSocket group chats with scroll managers
│   │   │   └── AutomationsPanel.jsx # SuperAdmin progression auditing & timetables
│   │   ├── App.jsx           # Routing trees, dark styling grids, and protection checks
│   │   ├── index.css         # Styling custom overlays (glassmorphism details)
│   │   └── main.jsx          # React app mounter
│   ├── index.html            # Web entry and font tags
│   ├── vite.config.js        # Vite port configurations and endpoint proxies
│   ├── tailwind.config.js    # Customized dark palette configurations
│   ├── postcss.config.js     # PostCSS configurations
│   └── package.json          # Client-side packages
├── package.json              # Workspace entry point managing concurrent execution
└── README.md                 # System operational instructions
```

---

## 🛠️ API Routing & System Blueprints

### 1. Authentication Router (`/api/auth`)
*   `POST /api/auth/register`: Creates new user account. If registering as a Student, automatically validates and binds the user record to a pre-existing `Student` profile matching the selected `class_level` and `roll_number`.
*   `POST /api/auth/login`: Signs and returns an HTTP Bearer JWT token alongside user details.
*   `GET /api/auth/me`: Decodes JWT tokens and returns current user details with fully populated student profiles.

### 2. Student Management Router (`/api/students`)
*   `GET /api/students`: Lists class rosters (paginated). Supports live query strings, searches, and fee-status filters.
*   `POST /api/students`: Registers new student profiles (auto-creates a blank 12-month payment ledger). (Admin/Teacher only)
*   `GET /api/students/:id`: Retrieves comprehensive profile details, including attendance history and exam progress.
*   `PUT /api/students/:id`: Updates student details. (Admin/Teacher only)
*   `DELETE /api/students/:id`: Removes student profile and associated ledgers. (Admin/Teacher only)
*   `POST /api/students/attendance/bulk`: Commits daily class sheets (increments total/attended calendars). (Admin/Teacher only)
*   `POST /api/students/:id/test-scores`: Appends subject exam scores (grades, totals, dates). (Admin/Teacher only)

### 3. Tuition Ledger & Gateway Webhooks (`/api/fees`)
*   `GET /api/fees/stats`: Aggregates Expected Revenue, Collected Revenue, and Outstanding Balances. (SuperAdmin only)
*   `GET /api/fees/ledger/:student_id`: Retrieves rolling monthly records for a specific student.
*   `PUT /api/fees/manual`: Manually marks payments (updates receipt IDs, payment methods, and timestamps). (Admin/Teacher only)
*   `POST /api/fees/webhook`: Simulates successful external credit-card processors. Overrides monthly indicators to "Paid" on successful payload delivery.

### 4. LMS Handouts Center (`/api/study-materials`)
*   `GET /api/study-materials`: Retrieves handouts. Automatically restricts queries to the student's class if a Student role request.
*   `POST /api/study-materials/upload`: Receives file attachments via Multer. (Admin/Teacher only)
*   `PUT /api/study-materials/:id`: Modifies delivery pipeline stages ('Drafting', 'Notes Distributed', 'Assignment Assigned', 'Revised'). (Admin/Teacher only)
*   `DELETE /api/study-materials/:id`: Removes files from server and database records. (Admin/Teacher only)

### 5. WebSocket Chats (`Socket.io`)
*   `join_room`: Links connections to Class rooms ('VII', 'VIII', 'IX', 'X') based on grade.
*   `send_message`: Processes incoming messages, archives to MongoDB `ChatMessage` schema, and broadcasts updates instantly to room members.

---

## ⚡ Background Automation Daemons (`node-cron`)

1.  **Tuition Fee Nagging (Monthly - 5th at 08:00 AM)**:
    Scans the ledger collection. Identifies active students flagged as 'Unpaid' for the current month and fires automated payment reminders via Nodemailer.
2.  **Low Attendance Scanner (Weekly - Sunday at 09:00 AM)**:
    Checks running monthly attendance rates. Transmits warning notices if a student's rate falls below 75%.

---

## 🚀 Getting Started

### 📋 Prerequisites
*   Node.js (v18+)
*   npm
*   MongoDB Instance (running locally at `mongodb://localhost:27017` or cloud URI)

### 💻 Installation & Startup

1.  **Clone / Navigate** to the workspace:
    ```bash
    cd EduStride
    ```

2.  **Install All Dependencies** (root, backend, and frontend concurrently):
    ```bash
    npm run install-all
    ```

3.  **Run in Development Mode**:
    ```bash
    npm run dev
    ```
    *   **Backend Server**: Starts at `http://localhost:5000`
    *   **Vite React Client**: Opens at `http://localhost:3000` (with proxy handlers routed to backend)
