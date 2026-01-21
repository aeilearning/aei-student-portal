// server.js — Admin + Student Detail + Document Vault + RAPIDS Readiness
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

/* ===================== CONSTANTS ===================== */
const LEVELS = [1, 2, 3, 4];
const STUDENT_STATUSES = [
  "Pending Enrollment",
  "Active",
  "On Hold",
  "Completed",
  "Withdrawn",
];

const DOC_TYPES = [
  "ID",
  "Apprentice Card",
  "Journeyman Certificate",
  "Transcript",
  "Completion Certificate",
  "Affidavit of Experience",
  "RAPIDS Agreement",
  "Other",
];

const STUDENT_ID_TYPES = [
  "None",
  "Driver License",
  "State ID",
  "Passport",
  "Other",
];

/* ===================== BOOTSTRAP DB ===================== */
(async () => {
  try {
    await initDb();
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Database init failed:", err);
    process.exit(1);
  }
})();

/* ===================== VIEW ENGINE ===================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ===================== MIDDLEWARE ===================== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// SECURITY: In production, require a real SESSION_SECRET (do NOT silently use dev-secret)
const SESSION_SECRET = process.env.SESSION_SECRET;
if (isProduction && (!SESSION_SECRET || SESSION_SECRET.trim().length < 20)) {
  console.error(
    "❌ SESSION_SECRET missing/too short in production. Set it in Render Environment."
  );
  process.exit(1);
}

app.use(
  session({
    secret: SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  })
);

/* ===================== HELPERS ===================== */
const cleanEmail = (v) => String(v || "").trim().toLowerCase();

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) {
    return res.redirect("/login");
  }
  next();
};

function safeTempPassword(input) {
  const v = String(input ?? "").trim();
  return v.length ? v : null;
}

// cryptographically-strong temp password
function randomPassword() {
  return crypto.randomBytes(12).toString("base64url"); // ~16 chars
}

function isDuplicateEmailError(err) {
  return (
    err &&
    (err.code === "23505" ||
      String(err.message || "").includes("duplicate key"))
  );
}

// RAPIDS readiness: strict but practical.
function rapidsReadiness(student) {
  const required = [
    "program_name",
    "provider_program_id",
    "program_system_id",
    "student_id_no",
    "student_id_type",
    "enrollment_date",
  ];

  const missing = required.filter((k) => {
    const v = student[k];
    if (v === null || v === undefined) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    return false;
  });

  if (missing.length === 0) return { label: "✅ Ready", code: "ready", missing };
  if (missing.length <= 2) return { label: "⚠️ Nearly", code: "nearly", missing };
  return { label: "❌ Incomplete", code: "incomplete", missing };
}

function cleanText(v) {
  return String(v ?? "").trim();
}

function isBlank(v) {
  return String(v ?? "").trim() === "";
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ===================== EMAIL ===================== */
const MAIL_FROM = process.env.MAIL_FROM;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;
const BASE_URL = process.env.BASE_URL;
let mailTransporter = null;

function buildLoginUrl() {
  if (BASE_URL && String(BASE_URL).trim().length) {
    return `${String(BASE_URL).replace(/\/$/, "")}/login`;
  }
  return "/login";
}

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass || !MAIL_FROM) {
    console.warn("⚠️ SMTP not configured. Email sending disabled.");
    return null;
  }

  mailTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return mailTransporter;
}

async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) return;

  const transporter = getMailTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text,
    });
  } catch (err) {
    console.error("❌ Email send failed:", err);
  }
}

/* ===================== UPLOADS SETUP ===================== */
/**
 * Render note:
 * - If you attach a persistent disk, set UPLOAD_DIR to that mount path.
 * - Example: /var/data/uploads
 */
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const rand = crypto.randomBytes(8).toString("hex");
    cb(null, `${Date.now()}_${rand}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

/* ===================== ROOT ===================== */
app.get("/", (req, res) => res.redirect("/login"));

/* ===================== AUTH ===================== */
app.get("/login", (req, res) => {
  res.render("login", { message: req.query.msg || null });
});

app.post(
  "/login",
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
      email,
    ]);

    if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash)) {
      return res.redirect(
        "/login?msg=" + encodeURIComponent("Invalid email or password")
      );
    }

    req.session.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
    };

    if (rows[0].role === "admin") return res.redirect("/admin");
    if (rows[0].role === "student") return res.redirect("/student");
    if (rows[0].role === "employer") return res.redirect("/employer");

    return res.redirect("/login");
  })
);

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ===================== REGISTER + RESET ===================== */
app.get("/register", (req, res) => {
  res.render("register", { message: req.query.msg || null });
});

app.post(
  "/register",
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const role = cleanText(req.body.role); // student/employer
    const note = cleanText(req.body.note);

    if (!email || !["student", "employer"].includes(role)) {
      return res.redirect(
        "/register?msg=" + encodeURIComponent("Email and role are required.")
      );
    }

    await pool.query(
      `INSERT INTO access_requests (request_type, email, requested_role, note)
       VALUES ('register', $1, $2, $3)`,
      [email, role, note]
    );

    const adminText = [
      "New registration request received.",
      "",
      `Email: ${email}`,
      `Requested role: ${role}`,
      `Note: ${note || "None"}`,
    ].join("\n");

    const requesterText = [
      "Thanks for your request to access the AEI Student Portal.",
      "We received your registration request and will follow up if approved.",
      "",
      `Requested role: ${role}`,
    ].join("\n");

    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: "AEI Portal – New Registration Request",
      text: adminText,
    });

    await sendEmail({
      to: email,
      subject: "AEI Portal – Registration Request Received",
      text: requesterText,
    });

    return res.redirect(
      "/login?msg=" +
        encodeURIComponent(
          "Request received. American Electrical Innovations Ltd. will follow up if approved."
        )
    );
  })
);

app.get("/reset-password", (req, res) => {
  res.render("reset-password", { message: req.query.msg || null });
});

app.post(
  "/reset-password",
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const note = cleanText(req.body.note);

    if (!email) {
      return res.redirect(
        "/reset-password?msg=" + encodeURIComponent("Email is required.")
      );
    }

    await pool.query(
      `INSERT INTO access_requests (request_type, email, requested_role, note)
       VALUES ('reset_password', $1, '', $2)`,
      [email, note]
    );

    const adminText = [
      "New password reset request received.",
      "",
      `Email: ${email}`,
      `Note: ${note || "None"}`,
    ].join("\n");

    const requesterText = [
      "We received your password reset request for the AEI Student Portal.",
      "AEI will follow up with next steps.",
    ].join("\n");

    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: "AEI Portal – Password Reset Request",
      text: adminText,
    });

    await sendEmail({
      to: email,
      subject: "AEI Portal – Reset Request Received",
      text: requesterText,
    });

    return res.redirect(
      "/login?msg=" +
        encodeURIComponent(
          "Reset request received. American Electrical Innovations Ltd. will follow up."
        )
    );
  })
);

/* ===================== DASHBOARDS ===================== */
app.get(
  "/admin",
  requireRole("admin"),
  wrap(async (req, res) => {
    const students = await pool.query(
      `SELECT s.*, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC`
    );

    const employers = await pool.query(
      `SELECT e.*, u.email
       FROM employers e
       JOIN users u ON u.id = e.user_id
       ORDER BY e.id DESC`
    );

    const docCounts = await pool.query(
      `SELECT student_id, COUNT(*)::int AS cnt
       FROM student_documents
       GROUP BY student_id`
    );

    const docCountMap = new Map(
      docCounts.rows.map((r) => [String(r.student_id), r.cnt])
    );

    const studentsWithIndicators = students.rows.map((s) => {
      const r = rapidsReadiness(s);
      return {
        ...s,
        rapids_label: r.label,
        rapids_code: r.code,
        docs_count: docCountMap.get(String(s.id)) || 0,
      };
    });

    res.render("admin", {
      user: req.session.user,
      students: studentsWithIndicators,
      employers: employers.rows,
      LEVELS,
      STUDENT_STATUSES,
      message: req.query.msg || null,
    });
  })
);

app.get(
  "/student",
  requireRole("student"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `SELECT s.*, u.email
       FROM students s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [req.session.user.id]
    );

    if (!r.rows.length) {
      return res.redirect(
        "/login?msg=" +
          encodeURIComponent("Student profile not found. Contact AEI.")
      );
    }

    const documents = [];

    res.render("student", {
      user: req.session.user,
      student: r.rows[0],
      DOC_TYPES,
      STUDENT_ID_TYPES,
      documents,
      message: req.query.msg || null,
    });
  })
);

app.post(
  "/student/update-identity",
  requireRole("student"),
  wrap(async (req, res) => {
    const requiredFields = [
      "first_name",
      "last_name",
      "address",
      "city",
      "state",
      "zip_code",
      "phone",
      "employer_name",
      "date_of_birth",
      "sex",
      "employment_status",
      "pre_apprenticeship",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));
    const ssnNotProvided = req.body.ssn_not_provided === "on";

    if (missing.length || (!ssnNotProvided && isBlank(req.body.ssn))) {
      return res.redirect(
        "/student?msg=" +
          encodeURIComponent("Please complete all required identity fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET first_name=$1,
           middle_name=$2,
           last_name=$3,
           suffix=$4,
           address=$5,
           city=$6,
           state=$7,
           zip_code=$8,
           phone=$9,
           employer_name=$10,
           ssn=$11,
           ssn_not_provided=$12,
           date_of_birth=$13,
           sex=$14,
           employment_status=$15,
           pre_apprenticeship=$16
       WHERE user_id=$17`,
      [
        cleanText(req.body.first_name),
        cleanText(req.body.middle_name),
        cleanText(req.body.last_name),
        cleanText(req.body.suffix),
        cleanText(req.body.address),
        cleanText(req.body.city),
        cleanText(req.body.state),
        cleanText(req.body.zip_code),
        cleanText(req.body.phone),
        cleanText(req.body.employer_name),
        ssnNotProvided ? null : cleanText(req.body.ssn),
        ssnNotProvided,
        req.body.date_of_birth || null,
        cleanText(req.body.sex),
        cleanText(req.body.employment_status),
        cleanText(req.body.pre_apprenticeship),
        req.session.user.id,
      ]
    );

    return res.redirect("/student?msg=" + encodeURIComponent("Profile updated."));
  })
);

app.post(
  "/student/update-demographics",
  requireRole("student"),
  wrap(async (req, res) => {
    const requiredFields = [
      "ethnicity",
      "race",
      "veteran_status",
      "education_level",
      "disability",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        "/student?msg=" +
          encodeURIComponent("Please complete all required demographics fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET ethnicity=$1,
           race=$2,
           veteran_status=$3,
           education_level=$4,
           disability=$5
       WHERE user_id=$6`,
      [
        cleanText(req.body.ethnicity),
        cleanText(req.body.race),
        cleanText(req.body.veteran_status),
        cleanText(req.body.education_level),
        cleanText(req.body.disability),
        req.session.user.id,
      ]
    );

    return res.redirect(
      "/student?msg=" + encodeURIComponent("Demographics updated.")
    );
  })
);

app.post(
  "/student/update-occupation",
  requireRole("student"),
  wrap(async (req, res) => {
    const requiredFields = [
      "occupation_name",
      "occupation_code",
      "enrollment_date",
      "probationary_period_hours",
      "term_remaining_hours",
      "expected_completion_date",
      "otjl_credit_hours",
      "related_instruction_credit_hours",
      "related_instruction_provider",
      "entry_wage",
      "entry_wage_units",
      "wage_schedule",
      "journeyworker_wage",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        "/student?msg=" +
          encodeURIComponent("Please complete all required occupation fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET occupation_name=$1,
           occupation_code=$2,
           enrollment_date=$3,
           probationary_period_hours=$4,
           term_remaining_hours=$5,
           expected_completion_date=$6,
           otjl_credit_hours=$7,
           related_instruction_credit_hours=$8,
           related_instruction_provider=$9,
           entry_wage=$10,
           entry_wage_units=$11,
           wage_schedule=$12,
           journeyworker_wage=$13
       WHERE user_id=$14`,
      [
        cleanText(req.body.occupation_name),
        cleanText(req.body.occupation_code),
        req.body.enrollment_date || null,
        numberOrNull(req.body.probationary_period_hours),
        numberOrNull(req.body.term_remaining_hours),
        req.body.expected_completion_date || null,
        numberOrNull(req.body.otjl_credit_hours),
        numberOrNull(req.body.related_instruction_credit_hours),
        cleanText(req.body.related_instruction_provider),
        numberOrNull(req.body.entry_wage),
        cleanText(req.body.entry_wage_units),
        cleanText(req.body.wage_schedule),
        numberOrNull(req.body.journeyworker_wage),
        req.session.user.id,
      ]
    );

    return res.redirect(
      "/student?msg=" + encodeURIComponent("Occupation details updated.")
    );
  })
);

app.post(
  "/student/update-rapids",
  requireRole("student"),
  wrap(async (req, res) => {
    const required = [
      "program_name",
      "provider_program_id",
      "program_system_id",
      "student_id_no",
      "student_id_type",
      "enrollment_date",
    ];
    const missing = required.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        "/student?msg=" +
          encodeURIComponent("Please complete all required RAPIDS fields.")
      );
    }

    const enrollmentDate = req.body.enrollment_date ? req.body.enrollment_date : null;
    const exitDate = req.body.exit_date ? req.body.exit_date : null;

    await pool.query(
      `UPDATE students
       SET program_name=$1,
           provider_program_id=$2,
           program_system_id=$3,
           student_id_no=$4,
           student_id_type=$5,
           enrollment_date=$6,
           exit_date=$7,
           exit_type=$8,
           credential=$9
       WHERE user_id=$10`,
      [
        cleanText(req.body.program_name),
        cleanText(req.body.provider_program_id),
        cleanText(req.body.program_system_id),
        cleanText(req.body.student_id_no),
        cleanText(req.body.student_id_type),
        enrollmentDate,
        exitDate,
        cleanText(req.body.exit_type),
        cleanText(req.body.credential),
        req.session.user.id,
      ]
    );

    return res.redirect("/student?msg=" + encodeURIComponent("RAPIDS fields updated."));
  })
);

app.get(
  "/employer",
  requireRole("employer"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `SELECT e.*, u.email
       FROM employers e JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1`,
      [req.session.user.id]
    );

    if (!r.rows.length) {
      return res.redirect(
        "/login?msg=" +
          encodeURIComponent("Employer profile not found. Contact AEI.")
      );
    }

    const documents = [];

    res.render("employer", {
      user: req.session.user,
      employer: r.rows[0],
      DOC_TYPES,
      documents,
      message: req.query.msg || null,
    });
  })
);

/* ===================== ADMIN CREATE USERS ===================== */
async function createUser({ email, role, tempPasswordInput }) {
  const tempPassword = safeTempPassword(tempPasswordInput);
  const password = tempPassword || randomPassword();
  const hash = bcrypt.hashSync(password, 10);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1,$2,$3)
     RETURNING id`,
    [email, hash, role]
  );

  return { userId: user.rows[0].id, password };
}

// CREATE STUDENT
app.post(
  "/admin/students/create",
  requireRole("admin"),
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (!email)
      return res.redirect("/admin?msg=" + encodeURIComponent("Email required"));

    try {
      const { userId, password } = await createUser({
        email,
        role: "student",
        tempPasswordInput: req.body.temp_password,
      });

      await pool.query(`INSERT INTO students (user_id) VALUES ($1)`, [userId]);

      const loginUrl = buildLoginUrl();
      const studentText = [
        "Your AEI Student Portal account has been created.",
        "",
        `Email: ${email}`,
        `Temporary password: ${password}`,
        `Login: ${loginUrl}`,
      ].join("\n");

      await sendEmail({
        to: email,
        subject: "AEI Portal – Your Account Details",
        text: studentText,
      });

      return res.redirect(
        "/admin?msg=" +
          encodeURIComponent(`Student created. Temp password: ${password}`)
      );
    } catch (e) {
      if (isDuplicateEmailError(e)) {
        return res.redirect(
          "/admin?msg=" + encodeURIComponent("Email already exists")
        );
      }
      throw e;
    }
  })
);

// CREATE EMPLOYER
app.post(
  "/admin/employers/create",
  requireRole("admin"),
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (!email)
      return res.redirect("/admin?msg=" + encodeURIComponent("Email required"));

    try {
      const { userId, password } = await createUser({
        email,
        role: "employer",
        tempPasswordInput: req.body.temp_password,
      });

      await pool.query(`INSERT INTO employers (user_id) VALUES ($1)`, [userId]);

      const loginUrl = buildLoginUrl();
      const employerText = [
        "Your AEI Employer Portal account has been created.",
        "",
        `Email: ${email}`,
        `Temporary password: ${password}`,
        `Login: ${loginUrl}`,
      ].join("\n");

      await sendEmail({
        to: email,
        subject: "AEI Portal – Your Account Details",
        text: employerText,
      });

      return res.redirect(
        "/admin?msg=" +
          encodeURIComponent(`Employer created. Temp password: ${password}`)
      );
    } catch (e) {
      if (isDuplicateEmailError(e)) {
        return res.redirect(
          "/admin?msg=" + encodeURIComponent("Email already exists")
        );
      }
      throw e;
    }
  })
);

/* ===================== ADMIN: STUDENT DETAIL ===================== */
app.get(
  "/admin/students/:id",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const s = await pool.query(
      `SELECT s.*, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [studentId]
    );

    if (!s.rows.length) {
      return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));
    }

    const docs = await pool.query(
      `SELECT d.*, u.email AS uploader_email
       FROM student_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by_user_id
       WHERE d.student_id = $1
       ORDER BY d.created_at DESC`,
      [studentId]
    );

    const readiness = rapidsReadiness(s.rows[0]);

    res.render("admin-student", {
      user: req.session.user,
      student: s.rows[0],
      docs: docs.rows,
      readiness,
      LEVELS,
      STUDENT_STATUSES,
      DOC_TYPES,
      STUDENT_ID_TYPES,
      message: req.query.msg || null,
    });
  })
);

app.post(
  "/admin/students/:id/update-identity",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const requiredFields = [
      "first_name",
      "last_name",
      "address",
      "city",
      "state",
      "zip_code",
      "phone",
      "employer_name",
      "date_of_birth",
      "sex",
      "employment_status",
      "pre_apprenticeship",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));
    const ssnNotProvided = req.body.ssn_not_provided === "on";

    if (missing.length || (!ssnNotProvided && isBlank(req.body.ssn))) {
      return res.redirect(
        `/admin/students/${studentId}?msg=` +
          encodeURIComponent("Please complete all required identity fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET first_name=$1,
           middle_name=$2,
           last_name=$3,
           suffix=$4,
           address=$5,
           city=$6,
           state=$7,
           zip_code=$8,
           phone=$9,
           employer_name=$10,
           ssn=$11,
           ssn_not_provided=$12,
           date_of_birth=$13,
           sex=$14,
           employment_status=$15,
           pre_apprenticeship=$16,
           level=$17,
           status=$18
       WHERE id=$19`,
      [
        cleanText(req.body.first_name),
        cleanText(req.body.middle_name),
        cleanText(req.body.last_name),
        cleanText(req.body.suffix),
        cleanText(req.body.address),
        cleanText(req.body.city),
        cleanText(req.body.state),
        cleanText(req.body.zip_code),
        cleanText(req.body.phone),
        cleanText(req.body.employer_name),
        ssnNotProvided ? null : cleanText(req.body.ssn),
        ssnNotProvided,
        req.body.date_of_birth || null,
        cleanText(req.body.sex),
        cleanText(req.body.employment_status),
        cleanText(req.body.pre_apprenticeship),
        Number(req.body.level || 1),
        cleanText(req.body.status),
        studentId,
      ]
    );

    return res.redirect(
      `/admin/students/${studentId}?msg=` +
        encodeURIComponent("Identity / Progress updated")
    );
  })
);

app.post(
  "/admin/students/:id/update-rapids",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const required = [
      "program_name",
      "provider_program_id",
      "program_system_id",
      "student_id_no",
      "student_id_type",
      "enrollment_date",
    ];
    const missing = required.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        `/admin/students/${studentId}?msg=` +
          encodeURIComponent("Please complete all required RAPIDS fields.")
      );
    }

    const enrollmentDate = req.body.enrollment_date ? req.body.enrollment_date : null;
    const exitDate = req.body.exit_date ? req.body.exit_date : null;

    await pool.query(
      `UPDATE students
       SET program_name=$1,
           provider_program_id=$2,
           program_system_id=$3,
           student_id_no=$4,
           student_id_type=$5,
           enrollment_date=$6,
           exit_date=$7,
           exit_type=$8,
           credential=$9
       WHERE id=$10`,
      [
        cleanText(req.body.program_name),
        cleanText(req.body.provider_program_id),
        cleanText(req.body.program_system_id),
        cleanText(req.body.student_id_no),
        cleanText(req.body.student_id_type),
        enrollmentDate,
        exitDate,
        cleanText(req.body.exit_type),
        cleanText(req.body.credential),
        studentId,
      ]
    );

    return res.redirect(
      `/admin/students/${studentId}?msg=` +
        encodeURIComponent("RAPIDS fields updated")
    );
  })
);

app.post(
  "/admin/students/:id/update-demographics",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);
    const requiredFields = [
      "ethnicity",
      "race",
      "veteran_status",
      "education_level",
      "disability",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        `/admin/students/${studentId}?msg=` +
          encodeURIComponent("Please complete all required demographics fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET ethnicity=$1,
           race=$2,
           veteran_status=$3,
           education_level=$4,
           disability=$5
       WHERE id=$6`,
      [
        cleanText(req.body.ethnicity),
        cleanText(req.body.race),
        cleanText(req.body.veteran_status),
        cleanText(req.body.education_level),
        cleanText(req.body.disability),
        studentId,
      ]
    );

    return res.redirect(
      `/admin/students/${studentId}?msg=` +
        encodeURIComponent("Demographics updated")
    );
  })
);

app.post(
  "/admin/students/:id/update-occupation",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);
    const requiredFields = [
      "occupation_name",
      "occupation_code",
      "enrollment_date",
      "probationary_period_hours",
      "term_remaining_hours",
      "expected_completion_date",
      "otjl_credit_hours",
      "related_instruction_credit_hours",
      "related_instruction_provider",
      "entry_wage",
      "entry_wage_units",
      "wage_schedule",
      "journeyworker_wage",
    ];
    const missing = requiredFields.filter((f) => isBlank(req.body[f]));

    if (missing.length) {
      return res.redirect(
        `/admin/students/${studentId}?msg=` +
          encodeURIComponent("Please complete all required occupation fields.")
      );
    }

    await pool.query(
      `UPDATE students
       SET occupation_name=$1,
           occupation_code=$2,
           enrollment_date=$3,
           probationary_period_hours=$4,
           term_remaining_hours=$5,
           expected_completion_date=$6,
           otjl_credit_hours=$7,
           related_instruction_credit_hours=$8,
           related_instruction_provider=$9,
           entry_wage=$10,
           entry_wage_units=$11,
           wage_schedule=$12,
           journeyworker_wage=$13
       WHERE id=$14`,
      [
        cleanText(req.body.occupation_name),
        cleanText(req.body.occupation_code),
        req.body.enrollment_date || null,
        numberOrNull(req.body.probationary_period_hours),
        numberOrNull(req.body.term_remaining_hours),
        req.body.expected_completion_date || null,
        numberOrNull(req.body.otjl_credit_hours),
        numberOrNull(req.body.related_instruction_credit_hours),
        cleanText(req.body.related_instruction_provider),
        numberOrNull(req.body.entry_wage),
        cleanText(req.body.entry_wage_units),
        cleanText(req.body.wage_schedule),
        numberOrNull(req.body.journeyworker_wage),
        studentId,
      ]
    );

    return res.redirect(
      `/admin/students/${studentId}?msg=` +
        encodeURIComponent("Occupation details updated")
    );
  })
);

// ADMIN upload/download only (student/employer vault wiring is next round)
app.post(
  "/admin/students/:id/docs/upload",
  requireRole("admin"),
  upload.single("doc_file"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    if (!req.file) {
      return res.redirect(
        `/admin/students/${studentId}?msg=` +
          encodeURIComponent("No file selected")
      );
    }

    const docType = cleanText(req.body.doc_type);
    const title = cleanText(req.body.title);

    await pool.query(
      `INSERT INTO student_documents
       (student_id, uploaded_by_user_id, doc_type, title, original_filename, stored_filename, mime_type, file_size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        studentId,
        req.session.user.id,
        docType || "Other",
        title || req.file.originalname,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype || "application/octet-stream",
        Number(req.file.size || 0),
      ]
    );

    return res.redirect(
      `/admin/students/${studentId}?msg=` +
        encodeURIComponent("Document uploaded")
    );
  })
);

app.get(
  "/admin/docs/:docId/download",
  requireRole("admin"),
  wrap(async (req, res) => {
    const docId = Number(req.params.docId);

    const d = await pool.query(`SELECT * FROM student_documents WHERE id=$1`, [docId]);
    if (!d.rows.length) return res.status(404).send("Not found");

    const doc = d.rows[0];
    const filePath = path.join(uploadDir, doc.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).send("File missing");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.original_filename.replace(/"/g, "")}"`
    );
    return res.download(filePath);
  })
);

/* ===================== ADMIN DELETE ===================== */
app.post(
  "/admin/students/:id/delete",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const s = await pool.query(`SELECT user_id FROM students WHERE id=$1`, [studentId]);
    if (!s.rows.length) {
      return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));
    }

    const userId = s.rows[0].user_id;
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);

    return res.redirect("/admin?msg=" + encodeURIComponent("Student deleted"));
  })
);

/* ===================== ADMIN: EMPLOYER DETAIL ===================== */
app.get(
  "/admin/employers/:id",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);

    const e = await pool.query(
      `SELECT e.*, u.email
       FROM employers e
       JOIN users u ON u.id = e.user_id
       WHERE e.id = $1`,
      [employerId]
    );

    if (!e.rows.length) {
      return res.redirect("/admin?msg=" + encodeURIComponent("Employer not found"));
    }

    res.render("admin-employer", {
      user: req.session.user,
      employer: e.rows[0],
      message: req.query.msg || null,
    });
  })
);

app.post(
  "/admin/employers/:id/update",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);

    const missing = ["company_name", "contact_name", "phone"].filter((f) =>
      isBlank(req.body[f])
    );

    if (missing.length) {
      return res.redirect(
        `/admin/employers/${employerId}?msg=` +
          encodeURIComponent("Please complete all required employer fields.")
      );
    }

    await pool.query(
      `UPDATE employers
       SET company_name=$1, contact_name=$2, phone=$3
       WHERE id=$4`,
      [
        cleanText(req.body.company_name),
        cleanText(req.body.contact_name),
        cleanText(req.body.phone),
        employerId,
      ]
    );

    return res.redirect(
      `/admin/employers/${employerId}?msg=` +
        encodeURIComponent("Employer profile updated.")
    );
  })
);

app.post(
  "/admin/employers/:id/delete",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);

    const e = await pool.query(`SELECT user_id FROM employers WHERE id=$1`, [employerId]);
    if (!e.rows.length) {
      return res.redirect("/admin?msg=" + encodeURIComponent("Employer not found"));
    }

    const userId = e.rows[0].user_id;
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);

    return res.redirect("/admin?msg=" + encodeURIComponent("Employer deleted"));
  })
);

/* ===================== ERROR HANDLER ===================== */
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).send("Server error. Check logs.");
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`🚀 AEI portal running on port ${PORT}`);
});

/* ===================== ROUTE LIST ===================== */
app.get("/__routes", (req, res) => {
  res.json(
    app._router.stack
      .filter((r) => r.route)
      .map(
        (r) => Object.keys(r.route.methods)[0].toUpperCase() + " " + r.route.path
      )
  );
});
