// server.js — Admin + Student Detail + Document Vault + RAPIDS Readiness

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
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

function randomPassword() {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 6)
  );
}

function isDuplicateEmailError(err) {
  return (
    err &&
    (err.code === "23505" ||
      String(err.message || "").includes("duplicate key"))
  );
}

// RAPIDS readiness: strict but practical.
// You can tighten later based on exact required export columns.
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

/* ===================== UPLOADS SETUP ===================== */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`);
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

/* ===================== DASHBOARDS ===================== */
app.get(
  "/admin",
  requireRole("admin"),
  wrap(async (req, res) => {
    // Slim list only (no clutter)
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

    // Doc counts for quick view
    const docCounts = await pool.query(
      `SELECT student_id, COUNT(*)::int AS cnt
       FROM student_documents
       GROUP BY student_id`
    );

    const docCountMap = new Map(docCounts.rows.map((r) => [String(r.student_id), r.cnt]));

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

    res.render("student", {
      user: req.session.user,
      student: r.rows[0],
    });
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

    res.render("employer", {
      user: req.session.user,
      employer: r.rows[0],
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

// UPDATE STUDENT IDENTITY + BASIC PROGRESS
app.post(
  "/admin/students/:id/update-identity",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    await pool.query(
      `UPDATE students
       SET first_name=$1, last_name=$2, phone=$3, employer_name=$4, level=$5, status=$6
       WHERE id=$7`,
      [
        cleanText(req.body.first_name),
        cleanText(req.body.last_name),
        cleanText(req.body.phone),
        cleanText(req.body.employer_name),
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

// UPDATE RAPIDS FIELDS
app.post(
  "/admin/students/:id/update-rapids",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const enrollmentDate = req.body.enrollment_date
      ? req.body.enrollment_date
      : null;
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

// UPLOAD DOCUMENT (Admin-only this revision)
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

// DOWNLOAD DOCUMENT (Admin-only this revision)
app.get(
  "/admin/docs/:docId/download",
  requireRole("admin"),
  wrap(async (req, res) => {
    const docId = Number(req.params.docId);

    const d = await pool.query(
      `SELECT * FROM student_documents WHERE id=$1`,
      [docId]
    );

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

    // deletes student row; cascades to user and docs via FK cascade on students? docs cascade on student_id.
    // user cascade is via students.user_id unique reference + ON DELETE CASCADE in students, but we delete student first here.
    const s = await pool.query(`SELECT user_id FROM students WHERE id=$1`, [studentId]);
    if (!s.rows.length) return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));

    const userId = s.rows[0].user_id;

    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);

    return res.redirect("/admin?msg=" + encodeURIComponent("Student deleted"));
  })
);

app.post(
  "/admin/employers/:id/delete",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);

    const e = await pool.query(`SELECT user_id FROM employers WHERE id=$1`, [employerId]);
    if (!e.rows.length) return res.redirect("/admin?msg=" + encodeURIComponent("Employer not found"));

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
        (r) =>
          Object.keys(r.route.methods)[0].toUpperCase() + " " + r.route.path
      )
  );
});
