// server.js — ADMIN + STUDENT + EMPLOYER + DOCUMENT VAULT + EXPORTS

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { stringify } = require("csv-stringify/sync");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

/* ===================== CONSTANTS FOR VIEWS ===================== */
const LEVELS = [1, 2, 3, 4];
const STUDENT_STATUSES = ["Pending Enrollment", "Active", "On Hold", "Completed", "Withdrawn"];

const DOC_TYPES = [
  "ID",
  "Apprentice Card",
  "Journeyman Certificate",
  "Affidavit of Experience",
  "Transcript",
  "Completion Certificate",
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

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.redirect("/login");
  next();
};

const requireAnyRole = (roles) => (req, res, next) => {
  if (!req.session.user) return res.redirect("/login");
  if (!roles.includes(req.session.user.role)) return res.redirect("/login");
  next();
};

function safeTempPassword(input) {
  const v = String(input ?? "").trim();
  return v.length ? v : null;
}

function randomPassword() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 6);
}

function isDuplicateEmailError(err) {
  return err && (err.code === "23505" || String(err.message || "").includes("duplicate key"));
}

/* ===================== UPLOADS (LOCAL) ===================== */
// NOTE: Render’s filesystem can be ephemeral unless you attach a persistent disk.
// This is still fine for an initial hard-compliance build; next revision can move to S3.
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeBase = String(file.originalname || "file")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 120);
    const stamp = Date.now();
    cb(null, `${stamp}_${Math.random().toString(36).slice(2)}_${safeBase}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file for now
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

    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

    if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash)) {
      return res.redirect("/login?msg=" + encodeURIComponent("Invalid email or password"));
    }

    req.session.user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };

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

    res.render("admin", {
      user: req.session.user,
      students: students.rows,
      employers: employers.rows,
      LEVELS,
      STUDENT_STATUSES,
      DOC_TYPES,
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
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [req.session.user.id]
    );

    const docs = await pool.query(
      `SELECT * FROM documents
       WHERE owner_user_id = $1
       ORDER BY uploaded_at DESC`,
      [req.session.user.id]
    );

    res.render("student", {
      user: req.session.user,
      student: r.rows[0],
      documents: docs.rows,
      DOC_TYPES,
      message: req.query.msg || null,
    });
  })
);

app.get(
  "/employer",
  requireRole("employer"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `SELECT e.*, u.email
       FROM employers e
       JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1`,
      [req.session.user.id]
    );

    const docs = await pool.query(
      `SELECT * FROM documents
       WHERE owner_user_id = $1
       ORDER BY uploaded_at DESC`,
      [req.session.user.id]
    );

    res.render("employer", {
      user: req.session.user,
      employer: r.rows[0],
      documents: docs.rows,
      DOC_TYPES,
      message: req.query.msg || null,
    });
  })
);

/* ===================== ADMIN CREATE ===================== */
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
    if (!email) return res.redirect("/admin?msg=" + encodeURIComponent("Email required"));

    try {
      const { userId, password } = await createUser({
        email,
        role: "student",
        tempPasswordInput: req.body.temp_password,
      });

      await pool.query(`INSERT INTO students (user_id) VALUES ($1)`, [userId]);

      return res.redirect("/admin?msg=" + encodeURIComponent(`Student created. Temp password: ${password}`));
    } catch (e) {
      if (isDuplicateEmailError(e)) return res.redirect("/admin?msg=" + encodeURIComponent("Email already exists"));
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
    if (!email) return res.redirect("/admin?msg=" + encodeURIComponent("Email required"));

    try {
      const { userId, password } = await createUser({
        email,
        role: "employer",
        tempPasswordInput: req.body.temp_password,
      });

      await pool.query(`INSERT INTO employers (user_id) VALUES ($1)`, [userId]);

      return res.redirect("/admin?msg=" + encodeURIComponent(`Employer created. Temp password: ${password}`));
    } catch (e) {
      if (isDuplicateEmailError(e)) return res.redirect("/admin?msg=" + encodeURIComponent("Email already exists"));
      throw e;
    }
  })
);

/* ===================== ADMIN UPDATE/DELETE (STUDENTS) ===================== */
app.post(
  "/admin/students/:id/update",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    // status change auditing
    const cur = await pool.query(`SELECT status FROM students WHERE id=$1`, [studentId]);
    if (!cur.rows.length) return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));

    const oldStatus = cur.rows[0].status;
    const newStatus = String(req.body.status || oldStatus);

    await pool.query(
      `UPDATE students SET
        first_name=$1, last_name=$2, phone=$3, employer_name=$4,
        level=$5, status=$6,
        general_program_name=$7, provider_general_program_id=$8, program_system_id=$9,
        student_id_no=$10, student_id_no_type=$11,
        exit_date=$12, exit_type=$13, credential_awarded=$14
       WHERE id=$15`,
      [
        String(req.body.first_name || ""),
        String(req.body.last_name || ""),
        String(req.body.phone || ""),
        String(req.body.employer_name || ""),
        Number(req.body.level || 1),
        newStatus,
        String(req.body.general_program_name || ""),
        String(req.body.provider_general_program_id || ""),
        String(req.body.program_system_id || ""),
        String(req.body.student_id_no || ""),
        String(req.body.student_id_no_type || "Other"),
        req.body.exit_date ? String(req.body.exit_date) : null,
        String(req.body.exit_type || ""),
        String(req.body.credential_awarded || "").toLowerCase() === "true",
        studentId,
      ]
    );

    if (oldStatus !== newStatus) {
      await pool.query(
        `INSERT INTO student_status_history (student_id, old_status, new_status, changed_by_user_id)
         VALUES ($1,$2,$3,$4)`,
        [studentId, oldStatus, newStatus, req.session.user.id]
      );
    }

    return res.redirect("/admin?msg=" + encodeURIComponent("Student updated"));
  })
);

app.post(
  "/admin/students/:id/delete",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);
    await pool.query(`DELETE FROM students WHERE id=$1`, [studentId]);
    return res.redirect("/admin?msg=" + encodeURIComponent("Student deleted"));
  })
);

/* ===================== ADMIN UPDATE/DELETE (EMPLOYERS) ===================== */
app.post(
  "/admin/employers/:id/update",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);
    await pool.query(
      `UPDATE employers SET company_name=$1, contact_name=$2, phone=$3 WHERE id=$4`,
      [
        String(req.body.company_name || ""),
        String(req.body.contact_name || ""),
        String(req.body.phone || ""),
        employerId,
      ]
    );
    return res.redirect("/admin?msg=" + encodeURIComponent("Employer updated"));
  })
);

app.post(
  "/admin/employers/:id/delete",
  requireRole("admin"),
  wrap(async (req, res) => {
    const employerId = Number(req.params.id);
    await pool.query(`DELETE FROM employers WHERE id=$1`, [employerId]);
    return res.redirect("/admin?msg=" + encodeURIComponent("Employer deleted"));
  })
);

/* ===================== DOCUMENT UPLOADS ===================== */
// student self-upload
app.post(
  "/student/documents/upload",
  requireRole("student"),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) return res.redirect("/student?msg=" + encodeURIComponent("No file uploaded"));

    const student = await pool.query(`SELECT id FROM students WHERE user_id=$1`, [req.session.user.id]);
    const studentId = student.rows.length ? student.rows[0].id : null;

    await pool.query(
      `INSERT INTO documents (
        owner_user_id, student_id, uploaded_by_user_id,
        doc_type, title, notes,
        original_filename, stored_filename, storage_path, mime_type, size_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        req.session.user.id,
        studentId,
        req.session.user.id,
        String(req.body.doc_type || "Other"),
        String(req.body.title || ""),
        String(req.body.notes || ""),
        req.file.originalname,
        req.file.filename,
        req.file.path,
        req.file.mimetype || "application/octet-stream",
        Number(req.file.size || 0),
      ]
    );

    return res.redirect("/student?msg=" + encodeURIComponent("Document uploaded"));
  })
);

// employer self-upload
app.post(
  "/employer/documents/upload",
  requireRole("employer"),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) return res.redirect("/employer?msg=" + encodeURIComponent("No file uploaded"));

    const employer = await pool.query(`SELECT id FROM employers WHERE user_id=$1`, [req.session.user.id]);
    const employerId = employer.rows.length ? employer.rows[0].id : null;

    await pool.query(
      `INSERT INTO documents (
        owner_user_id, employer_id, uploaded_by_user_id,
        doc_type, title, notes,
        original_filename, stored_filename, storage_path, mime_type, size_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        req.session.user.id,
        employerId,
        req.session.user.id,
        String(req.body.doc_type || "Other"),
        String(req.body.title || ""),
        String(req.body.notes || ""),
        req.file.originalname,
        req.file.filename,
        req.file.path,
        req.file.mimetype || "application/octet-stream",
        Number(req.file.size || 0),
      ]
    );

    return res.redirect("/employer?msg=" + encodeURIComponent("Document uploaded"));
  })
);

// admin upload to a specific student
app.post(
  "/admin/students/:id/documents/upload",
  requireRole("admin"),
  upload.single("file"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);
    if (!req.file) return res.redirect("/admin?msg=" + encodeURIComponent("No file uploaded"));

    const s = await pool.query(`SELECT user_id FROM students WHERE id=$1`, [studentId]);
    if (!s.rows.length) return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));

    const ownerUserId = s.rows[0].user_id;

    await pool.query(
      `INSERT INTO documents (
        owner_user_id, student_id, uploaded_by_user_id,
        doc_type, title, notes,
        original_filename, stored_filename, storage_path, mime_type, size_bytes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ownerUserId,
        studentId,
        req.session.user.id,
        String(req.body.doc_type || "Other"),
        String(req.body.title || ""),
        String(req.body.notes || ""),
        req.file.originalname,
        req.file.filename,
        req.file.path,
        req.file.mimetype || "application/octet-stream",
        Number(req.file.size || 0),
      ]
    );

    return res.redirect("/admin?msg=" + encodeURIComponent("Document uploaded to student"));
  })
);

/* ===================== DOCUMENT DOWNLOAD (ROLE CHECKED) ===================== */
app.get(
  "/documents/:id/download",
  requireAnyRole(["admin", "student", "employer"]),
  wrap(async (req, res) => {
    const docId = Number(req.params.id);
    const d = await pool.query(`SELECT * FROM documents WHERE id=$1`, [docId]);
    if (!d.rows.length) return res.status(404).send("Not found");

    const doc = d.rows[0];
    const role = req.session.user.role;

    // Admin can download anything
    if (role === "admin") {
      return res.download(doc.storage_path, doc.original_filename);
    }

    // Student/employer can only download what they own
    if (doc.owner_user_id !== req.session.user.id) {
      return res.status(403).send("Forbidden");
    }

    return res.download(doc.storage_path, doc.original_filename);
  })
);

app.post(
  "/documents/:id/delete",
  requireAnyRole(["admin", "student", "employer"]),
  wrap(async (req, res) => {
    const docId = Number(req.params.id);
    const d = await pool.query(`SELECT * FROM documents WHERE id=$1`, [docId]);
    if (!d.rows.length) return res.status(404).send("Not found");

    const doc = d.rows[0];
    const role = req.session.user.role;

    if (role !== "admin" && doc.owner_user_id !== req.session.user.id) {
      return res.status(403).send("Forbidden");
    }

    // remove row; student/employer should not be able to delete somebody else’s docs
    await pool.query(`DELETE FROM documents WHERE id=$1`, [docId]);

    // best-effort delete file
    try {
      fs.unlinkSync(doc.storage_path);
    } catch (_) {}

    if (role === "admin") return res.redirect("/admin?msg=" + encodeURIComponent("Document deleted"));
    if (role === "student") return res.redirect("/student?msg=" + encodeURIComponent("Document deleted"));
    return res.redirect("/employer?msg=" + encodeURIComponent("Document deleted"));
  })
);

/* ===================== EXPORTS (MATCH YOUR TEMPLATE HEADERS) ===================== */
// Enrolle Template headers:
// General Program Name, Provider General Program ID, Program_System ID, Enrollee Student ID No., Student ID No. Type, Program Entry Date
app.get(
  "/admin/export/enrollees.csv",
  requireRole("admin"),
  wrap(async (req, res) => {
    const students = await pool.query(`SELECT * FROM students ORDER BY id ASC`);

    const records = students.rows.map((s) => [
      s.general_program_name || "",
      s.provider_general_program_id || "",
      s.program_system_id || "",
      s.student_id_no || "",
      s.student_id_no_type || "Other",
      "", // Program Entry Date (next rev: store start_date and populate)
    ]);

    const csv = stringify(records, {
      header: true,
      columns: [
        "General Program Name",
        "Provider General Program ID",
        "Program_System ID",
        "Enrollee Student ID No.",
        "Student ID No. Type",
        "Program Entry Date",
      ],
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=enrollees.csv");
    return res.send(csv);
  })
);

// Exiter Template headers:
// General Program Name, Provider General Program ID, Program_System ID, Exiter Student ID No., Student ID No. Type,
// Date Student Exited Program, Exit Type, Credential Awarded Yes/No
app.get(
  "/admin/export/exiters.csv",
  requireRole("admin"),
  wrap(async (req, res) => {
    const students = await pool.query(`SELECT * FROM students ORDER BY id ASC`);

    const records = students.rows.map((s) => [
      s.general_program_name || "",
      s.provider_general_program_id || "",
      s.program_system_id || "",
      s.student_id_no || "",
      s.student_id_no_type || "Other",
      s.exit_date ? String(s.exit_date) : "",
      s.exit_type || "",
      s.credential_awarded ? "Yes" : "No",
    ]);

    const csv = stringify(records, {
      header: true,
      columns: [
        "General Program Name",
        "Provider General Program ID",
        "Program_System ID",
        "Exiter Student ID No.",
        "Student ID No. Type",
        "Date Student Exited Program",
        "Exit Type",
        "Credential Awarded Yes/No",
      ],
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=exiters.csv");
    return res.send(csv);
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
      .map((r) => Object.keys(r.route.methods)[0].toUpperCase() + " " + r.route.path)
  );
});
