// server.js — Admin + Student/Employer Document Vault (categorized) + Download-All
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const archiver = require("archiver");
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

/**
 * Fixed categories (dropdown required)
 * These are intentionally “human recognizable” so you don’t have to open files to guess what they are.
 */
const DOC_CATEGORIES = [
  "ID",
  "Apprentice Card",
  "Journeyman Certificate",
  "Transcript",
  "Completion Certificate",
  "Affidavit of Experience",
  "RAPIDS Agreement",
  "Employment / Pay Records",
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

/**
 * Sessions
 * NOTE: For production, you should set SESSION_SECRET in Render.
 */
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
const cleanText = (v) => String(v ?? "").trim();

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.redirect("/login");
  next();
};

const requireAnyRole = (roles) => (req, res, next) => {
  if (!req.session.user || !roles.includes(req.session.user.role)) return res.redirect("/login");
  next();
};

function isDuplicateEmailError(err) {
  return err && (err.code === "23505" || String(err.message || "").includes("duplicate key"));
}

function randomPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

function safeTempPassword(input) {
  const v = String(input ?? "").trim();
  return v.length ? v : null;
}

function slugifyFolder(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "other";
}

function safeFileName(name) {
  const base = String(name || "file")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return base.length ? base : "file";
}

/* ===================== UPLOADS SETUP ===================== */
/**
 * Recommended for Render:
 * - attach a persistent disk and set UPLOAD_DIR to that mount path
 *   e.g. /var/data/uploads
 */
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

/**
 * We store docs under:
 * uploads/<entity_type>/<entity_id>/<category_slug>/<timestamp_rand_filename>
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const ctx = req.uploadContext;
    if (!ctx || !ctx.entityType || !ctx.entityId || !ctx.category) {
      return cb(new Error("Upload context missing"));
    }

    const folder = path.join(
      uploadDir,
      ctx.entityType,
      String(ctx.entityId),
      slugifyFolder(ctx.category)
    );

    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    const safe = safeFileName(file.originalname).replace(/[^a-zA-Z0-9._ -]+/g, "_");
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
      return res.redirect("/register?msg=" + encodeURIComponent("Email and role are required."));
    }

    await pool.query(
      `INSERT INTO access_requests (request_type, email, requested_role, note)
       VALUES ('register', $1, $2, $3)`,
      [email, role, note]
    );

    return res.redirect(
      "/login?msg=" + encodeURIComponent("Request received. AEI will follow up if approved.")
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
      return res.redirect("/reset-password?msg=" + encodeURIComponent("Email is required."));
    }

    await pool.query(
      `INSERT INTO access_requests (request_type, email, requested_role, note)
       VALUES ('reset_password', $1, '', $2)`,
      [email, note]
    );

    return res.redirect("/login?msg=" + encodeURIComponent("Reset request received. AEI will follow up."));
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

    res.render("admin", {
      user: req.session.user,
      students: students.rows,
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
      return res.redirect("/login?msg=" + encodeURIComponent("Student profile not found. Contact AEI."));
    }

    const student = r.rows[0];

    const docs = await pool.query(
      `SELECT d.*
       FROM documents d
       WHERE d.entity_type='student' AND d.entity_id=$1
       ORDER BY d.created_at DESC`,
      [student.id]
    );

    // group by category
    const grouped = new Map();
    for (const d of docs.rows) {
      const key = d.category || "Other";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(d);
    }

    const groupedDocs = DOC_CATEGORIES
      .filter((c) => grouped.has(c))
      .map((c) => ({ category: c, docs: grouped.get(c) }))
      .concat(
        [...grouped.keys()]
          .filter((k) => !DOC_CATEGORIES.includes(k))
          .sort()
          .map((k) => ({ category: k, docs: grouped.get(k) }))
      );

    res.render("student", {
      user: req.session.user,
      student,
      DOC_CATEGORIES,
      groupedDocs,
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
       FROM employers e JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1`,
      [req.session.user.id]
    );

    if (!r.rows.length) {
      return res.redirect("/login?msg=" + encodeURIComponent("Employer profile not found. Contact AEI."));
    }

    const employer = r.rows[0];

    const docs = await pool.query(
      `SELECT d.*
       FROM documents d
       WHERE d.entity_type='employer' AND d.entity_id=$1
       ORDER BY d.created_at DESC`,
      [employer.id]
    );

    const grouped = new Map();
    for (const d of docs.rows) {
      const key = d.category || "Other";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(d);
    }

    const groupedDocs = DOC_CATEGORIES
      .filter((c) => grouped.has(c))
      .map((c) => ({ category: c, docs: grouped.get(c) }))
      .concat(
        [...grouped.keys()]
          .filter((k) => !DOC_CATEGORIES.includes(k))
          .sort()
          .map((k) => ({ category: k, docs: grouped.get(k) }))
      );

    res.render("employer", {
      user: req.session.user,
      employer,
      DOC_CATEGORIES,
      groupedDocs,
      message: req.query.msg || null,
    });
  })
);

/* ===================== STUDENT UPLOAD/DOWNLOAD ===================== */
app.post(
  "/student/documents/upload",
  requireRole("student"),
  wrap(async (req, res, next) => {
    // Resolve student
    const r = await pool.query(`SELECT id FROM students WHERE user_id=$1`, [req.session.user.id]);
    if (!r.rows.length) return res.redirect("/student?msg=" + encodeURIComponent("Student profile not found."));

    const studentId = r.rows[0].id;

    const category = cleanText(req.body.category);
    if (!category) return res.redirect("/student?msg=" + encodeURIComponent("Category is required."));

    // Provide context to multer destination
    req.uploadContext = { entityType: "student", entityId: studentId, category };
    upload.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.redirect("/student?msg=" + encodeURIComponent("No file selected."));

      const title = cleanText(req.body.title);

      // rel path from uploads root
      const relPath = path.relative(uploadDir, req.file.path).replace(/\\/g, "/");

      await pool.query(
        `INSERT INTO documents
         (entity_type, entity_id, category, title, original_filename, stored_rel_path, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ('student',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          studentId,
          category,
          title || req.file.originalname,
          req.file.originalname,
          relPath,
          req.file.mimetype || "application/octet-stream",
          Number(req.file.size || 0),
          req.session.user.id,
        ]
      );

      return res.redirect("/student?msg=" + encodeURIComponent("Document uploaded."));
    });
  })
);

app.get(
  "/student/documents/download-all",
  requireRole("student"),
  wrap(async (req, res) => {
    const r = await pool.query(`SELECT id FROM students WHERE user_id=$1`, [req.session.user.id]);
    if (!r.rows.length) return res.redirect("/student?msg=" + encodeURIComponent("Student profile not found."));
    const studentId = r.rows[0].id;

    const docs = await pool.query(
      `SELECT * FROM documents WHERE entity_type='student' AND entity_id=$1 ORDER BY created_at DESC`,
      [studentId]
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="student_documents_${studentId}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => { throw err; });
    archive.pipe(res);

    for (const d of docs.rows) {
      const filePath = path.join(uploadDir, d.stored_rel_path);
      if (!fs.existsSync(filePath)) continue;

      const folder = slugifyFolder(d.category || "Other");
      const fileName = safeFileName(d.title || d.original_filename || "file");
      archive.file(filePath, { name: `${folder}/${fileName}` });
    }

    await archive.finalize();
  })
);

/* ===================== EMPLOYER UPLOAD/DOWNLOAD ===================== */
app.post(
  "/employer/documents/upload",
  requireRole("employer"),
  wrap(async (req, res, next) => {
    const r = await pool.query(`SELECT id FROM employers WHERE user_id=$1`, [req.session.user.id]);
    if (!r.rows.length) return res.redirect("/employer?msg=" + encodeURIComponent("Employer profile not found."));

    const employerId = r.rows[0].id;

    const category = cleanText(req.body.category);
    if (!category) return res.redirect("/employer?msg=" + encodeURIComponent("Category is required."));

    req.uploadContext = { entityType: "employer", entityId: employerId, category };
    upload.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.redirect("/employer?msg=" + encodeURIComponent("No file selected."));

      const title = cleanText(req.body.title);
      const relPath = path.relative(uploadDir, req.file.path).replace(/\\/g, "/");

      await pool.query(
        `INSERT INTO documents
         (entity_type, entity_id, category, title, original_filename, stored_rel_path, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ('employer',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          employerId,
          category,
          title || req.file.originalname,
          req.file.originalname,
          relPath,
          req.file.mimetype || "application/octet-stream",
          Number(req.file.size || 0),
          req.session.user.id,
        ]
      );

      return res.redirect("/employer?msg=" + encodeURIComponent("Document uploaded."));
    });
  })
);

app.get(
  "/employer/documents/download-all",
  requireRole("employer"),
  wrap(async (req, res) => {
    const r = await pool.query(`SELECT id FROM employers WHERE user_id=$1`, [req.session.user.id]);
    if (!r.rows.length) return res.redirect("/employer?msg=" + encodeURIComponent("Employer profile not found."));
    const employerId = r.rows[0].id;

    const docs = await pool.query(
      `SELECT * FROM documents WHERE entity_type='employer' AND entity_id=$1 ORDER BY created_at DESC`,
      [employerId]
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="employer_documents_${employerId}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => { throw err; });
    archive.pipe(res);

    for (const d of docs.rows) {
      const filePath = path.join(uploadDir, d.stored_rel_path);
      if (!fs.existsSync(filePath)) continue;

      const folder = slugifyFolder(d.category || "Other");
      const fileName = safeFileName(d.title || d.original_filename || "file");
      archive.file(filePath, { name: `${folder}/${fileName}` });
    }

    await archive.finalize();
  })
);

/* ===================== SINGLE DOCUMENT DOWNLOAD (ROLE-SAFE) ===================== */
app.get(
  "/documents/:docId/download",
  requireAnyRole(["admin", "student", "employer"]),
  wrap(async (req, res) => {
    const docId = Number(req.params.docId);
    const d = await pool.query(`SELECT * FROM documents WHERE id=$1`, [docId]);
    if (!d.rows.length) return res.status(404).send("Not found");
    const doc = d.rows[0];

    // Access control:
    if (req.session.user.role !== "admin") {
      if (req.session.user.role === "student") {
        const s = await pool.query(`SELECT id FROM students WHERE user_id=$1`, [req.session.user.id]);
        if (!s.rows.length || doc.entity_type !== "student" || Number(doc.entity_id) !== Number(s.rows[0].id)) {
          return res.status(403).send("Forbidden");
        }
      } else if (req.session.user.role === "employer") {
        const e = await pool.query(`SELECT id FROM employers WHERE user_id=$1`, [req.session.user.id]);
        if (!e.rows.length || doc.entity_type !== "employer" || Number(doc.entity_id) !== Number(e.rows[0].id)) {
          return res.status(403).send("Forbidden");
        }
      }
    }

    const filePath = path.join(uploadDir, doc.stored_rel_path);
    if (!fs.existsSync(filePath)) return res.status(404).send("File missing");

    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(doc.original_filename)}"`);
    return res.download(filePath);
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

/* ===================== ADMIN: STUDENT DETAIL + DOCS ===================== */
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
    if (!s.rows.length) return res.redirect("/admin?msg=" + encodeURIComponent("Student not found"));

    const docs = await pool.query(
      `SELECT d.*, u.email AS uploader_email
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by_user_id
       WHERE d.entity_type='student' AND d.entity_id=$1
       ORDER BY d.created_at DESC`,
      [studentId]
    );

    // Group for display
    const grouped = new Map();
    for (const d of docs.rows) {
      const key = d.category || "Other";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(d);
    }

    const groupedDocs = DOC_CATEGORIES
      .filter((c) => grouped.has(c))
      .map((c) => ({ category: c, docs: grouped.get(c) }))
      .concat(
        [...grouped.keys()]
          .filter((k) => !DOC_CATEGORIES.includes(k))
          .sort()
          .map((k) => ({ category: k, docs: grouped.get(k) }))
      );

    res.render("admin-student", {
      user: req.session.user,
      student: s.rows[0],
      docs: docs.rows,
      groupedDocs,
      DOC_CATEGORIES,
      LEVELS,
      STUDENT_STATUSES,
      STUDENT_ID_TYPES,
      message: req.query.msg || null,
    });
  })
);

app.post(
  "/admin/students/:id/docs/upload",
  requireRole("admin"),
  wrap(async (req, res, next) => {
    const studentId = Number(req.params.id);

    const category = cleanText(req.body.category);
    if (!category) {
      return res.redirect(`/admin/students/${studentId}?msg=` + encodeURIComponent("Category is required."));
    }

    req.uploadContext = { entityType: "student", entityId: studentId, category };
    upload.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.redirect(`/admin/students/${studentId}?msg=` + encodeURIComponent("No file selected."));

      const title = cleanText(req.body.title);
      const relPath = path.relative(uploadDir, req.file.path).replace(/\\/g, "/");

      await pool.query(
        `INSERT INTO documents
         (entity_type, entity_id, category, title, original_filename, stored_rel_path, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ('student',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          studentId,
          category,
          title || req.file.originalname,
          req.file.originalname,
          relPath,
          req.file.mimetype || "application/octet-stream",
          Number(req.file.size || 0),
          req.session.user.id,
        ]
      );

      return res.redirect(`/admin/students/${studentId}?msg=` + encodeURIComponent("Document uploaded."));
    });
  })
);

app.get(
  "/admin/students/:id/docs/download-all",
  requireRole("admin"),
  wrap(async (req, res) => {
    const studentId = Number(req.params.id);

    const docs = await pool.query(
      `SELECT * FROM documents WHERE entity_type='student' AND entity_id=$1 ORDER BY created_at DESC`,
      [studentId]
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="student_${studentId}_documents.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => { throw err; });
    archive.pipe(res);

    for (const d of docs.rows) {
      const filePath = path.join(uploadDir, d.stored_rel_path);
      if (!fs.existsSync(filePath)) continue;

      const folder = slugifyFolder(d.category || "Other");
      const fileName = safeFileName(d.title || d.original_filename || "file");
      archive.file(filePath, { name: `${folder}/${fileName}` });
    }

    await archive.finalize();
  })
);

/* ===================== STUDENT UPDATE (stub so form never 404s) ===================== */
app.post(
  "/student/update",
  requireRole("student"),
  (req, res) => res.redirect("/student?msg=" + encodeURIComponent("Profile edits are managed by AEI administration."))
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
