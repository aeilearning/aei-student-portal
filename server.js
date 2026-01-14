const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- BOOTSTRAP DATABASE ---------- */
(async () => {
  try {
    await initDb();
    console.log("Database initialized");
  } catch (err) {
    console.error("Database init failed", err);
    process.exit(1);
  }
})();

/* ---------- VIEW ENGINE ---------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ---------- MIDDLEWARE ---------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // must remain false until HTTPS/custom domain
    },
  })
);

/* ---------- CONSTANTS ---------- */
const LEVELS = [1, 2, 3, 4];
const STUDENT_STATUSES = [
  "Pending Enrollment",
  "Active",
  "Paused",
  "Completed Level",
  "Pending Re-Enrollment",
  "Dropped",
];

/* ---------- HELPERS ---------- */
function cleanEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  next();
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.redirect("/login");
    next();
  };
}

function randomTempPassword() {
  return `Temp-${Math.random().toString(36).slice(2, 8)}!`;
}

/* ---------- ROOT ---------- */
app.get("/", (req, res) => res.redirect("/login"));

/* ---------- LOGIN ---------- */
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.post("/login", async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || "");

  const result = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (!result.rows.length) {
    return res.render("login", { message: "Invalid email or password" });
  }

  const user = result.rows[0];
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.render("login", { message: "Invalid email or password" });
  }

  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  if (user.role === "admin") return res.redirect("/admin");
  if (user.role === "student") return res.redirect("/student");
  if (user.role === "employer") return res.redirect("/employer");

  res.redirect("/login");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ======================================================
   ADMIN DASHBOARD
   ====================================================== */

app.get("/admin", requireAdmin, async (req, res) => {
  const students = await pool.query(`
    SELECT s.*, u.email
    FROM students s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.id ASC
  `);

  const employers = await pool.query(`
    SELECT e.*, u.email
    FROM employers e
    JOIN users u ON u.id = e.user_id
    ORDER BY e.id ASC
  `);

  res.render("admin", {
    user: req.session.user,
    students: students.rows,
    employers: employers.rows,
    LEVELS,
    STUDENT_STATUSES,
    message: null,
  });
});

/* ---------- ADMIN: CREATE STUDENT ---------- */
app.post("/admin/students/create", requireAdmin, async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email) return res.redirect("/admin");

  const password = req.body.temp_password || randomTempPassword();
  const hash = bcrypt.hashSync(password, 10);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1,$2,'student')
     RETURNING id`,
    [email, hash]
  );

  await pool.query(
    `INSERT INTO students (user_id, status, level)
     VALUES ($1,'Pending Enrollment',1)`,
    [user.rows[0].id]
  );

  res.redirect("/admin");
});

/* ---------- ADMIN: UPDATE STUDENT ---------- */
app.post("/admin/students/:id/update", requireAdmin, async (req, res) => {
  await pool.query(
    `UPDATE students
     SET first_name=$1,
         last_name=$2,
         phone=$3,
         employer_name=$4,
         status=$5,
         level=$6
     WHERE id=$7`,
    [
      req.body.first_name,
      req.body.last_name,
      req.body.phone,
      req.body.employer_name,
      req.body.status,
      Number(req.body.level),
      Number(req.params.id),
    ]
  );

  res.redirect("/admin");
});

/* ---------- ADMIN: DELETE STUDENT ---------- */
app.post("/admin/students/:id/delete", requireAdmin, async (req, res) => {
  const r = await pool.query(
    "SELECT user_id FROM students WHERE id=$1",
    [Number(req.params.id)]
  );

  if (r.rows.length) {
    await pool.query("DELETE FROM users WHERE id=$1", [r.rows[0].user_id]);
  }

  res.redirect("/admin");
});

/* ---------- ADMIN: CREATE EMPLOYER ---------- */
app.post("/admin/employers/create", requireAdmin, async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email) return res.redirect("/admin");

  const password = req.body.temp_password || randomTempPassword();
  const hash = bcrypt.hashSync(password, 10);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1,$2,'employer')
     RETURNING id`,
    [email, hash]
  );

  await pool.query(
    `INSERT INTO employers (user_id)
     VALUES ($1)`,
    [user.rows[0].id]
  );

  res.redirect("/admin");
});

/* ---------- ADMIN: UPDATE EMPLOYER ---------- */
app.post("/admin/employers/:id/update", requireAdmin, async (req, res) => {
  await pool.query(
    `UPDATE employers
     SET company_name=$1,
         contact_name=$2,
         phone=$3
     WHERE id=$4`,
    [
      req.body.company_name,
      req.body.contact_name,
      req.body.phone,
      Number(req.params.id),
    ]
  );

  res.redirect("/admin");
});

/* ---------- ADMIN: DELETE EMPLOYER ---------- */
app.post("/admin/employers/:id/delete", requireAdmin, async (req, res) => {
  const r = await pool.query(
    "SELECT user_id FROM employers WHERE id=$1",
    [Number(req.params.id)]
  );

  if (r.rows.length) {
    await pool.query("DELETE FROM users WHERE id=$1", [r.rows[0].user_id]);
  }

  res.redirect("/admin");
});

/* ======================================================
   STUDENT PORTAL
   ====================================================== */

app.get("/student", requireRole("student"), async (req, res) => {
  const r = await pool.query(
    `SELECT s.*, u.email
     FROM students s
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id=$1`,
    [req.session.user.id]
  );

  res.render("student", { user: req.session.user, student: r.rows[0] });
});

app.post("/student/update", requireRole("student"), async (req, res) => {
  await pool.query(
    `UPDATE students
     SET first_name=$1,
         last_name=$2,
         phone=$3,
         employer_name=$4
     WHERE user_id=$5`,
    [
      req.body.first_name,
      req.body.last_name,
      req.body.phone,
      req.body.employer_name,
      req.session.user.id,
    ]
  );

  res.redirect("/student");
});

/* ======================================================
   EMPLOYER PORTAL
   ====================================================== */

app.get("/employer", requireRole("employer"), async (req, res) => {
  const r = await pool.query(
    `SELECT e.*, u.email
     FROM employers e
     JOIN users u ON u.id = e.user_id
     WHERE e.user_id=$1`,
    [req.session.user.id]
  );

  res.render("employer", { user: req.session.user, employer: r.rows[0] });
});

app.post("/employer/update", requireRole("employer"), async (req, res) => {
  await pool.query(
    `UPDATE employers
     SET company_name=$1,
         contact_name=$2,
         phone=$3
     WHERE user_id=$4`,
    [
      req.body.company_name,
      req.body.contact_name,
      req.body.phone,
      req.session.user.id,
    ]
  );

  res.redirect("/employer");
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`AEI portal running on port ${PORT}`);
});
