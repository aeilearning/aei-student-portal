const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- DATABASE ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
    saveUninitialized: false
  })
);

/* ---------- CONSTANTS ---------- */
const LEVELS = ["1", "2", "3", "4"];
const STATUSES = [
  "Active",
  "Pending Enrollment",
  "Paused",
  "Completed Level",
  "Dropped"
];

/* ---------- DB INIT ---------- */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      student_id VARCHAR(6) UNIQUE NOT NULL,
      status TEXT NOT NULL,
      level TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      enrollment_date DATE,
      state_license TEXT,
      rapids TEXT,
      employer TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}
initDb();

/* ---------- AUTH ---------- */
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

/* ---------- ROUTES ---------- */
app.get("/", (req, res) => {
  res.redirect("/login");
});

/* ---------- LOGIN ---------- */
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM admins WHERE email=$1",
    [email]
  );

  if (!result.rows.length) {
    return res.render("login", { message: "Invalid login" });
  }

  const admin = result.rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);

  if (!ok) {
    return res.render("login", { message: "Invalid login" });
  }

  req.session.user = { id: admin.id, email: admin.email };
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ---------- ADMIN DASHBOARD ---------- */
app.get("/admin", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM students ORDER BY id ASC"
  );

  res.render("admin", {
    user: req.session.user,
    students: rows,
    LEVELS,
    STATUSES,
    message: null
  });
});

app.post("/admin/students", requireAdmin, async (req, res) => {
  const nextId = await pool.query(
    "SELECT COALESCE(MAX(student_id::int), 999) + 1 AS next FROM students"
  );

  const studentId = String(nextId.rows[0].next).padStart(6, "0");

  await pool.query(
    `INSERT INTO students
     (student_id, status, level, email, enrollment_date)
     VALUES ($1,'Pending Enrollment','1',$2,CURRENT_DATE)`,
    [studentId, req.body.email]
  );

  res.redirect("/admin");
});

app.post("/admin/update/:id", requireAdmin, async (req, res) => {
  await pool.query(
    "UPDATE students SET status=$1, level=$2 WHERE id=$3",
    [req.body.status, req.body.level, req.params.id]
  );
  res.redirect("/admin");
});

app.post("/admin/delete/:id", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM students WHERE id=$1",
    [req.params.id]
  );
  res.redirect("/admin");
});

/* ---------- ONE-TIME ADMIN SETUP ---------- */
app.get("/setup-admin", async (req, res) => {
  const email = "admin@aei.local";
  const password = "ChangeMeNow123!";
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO admins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, hash]
  );

  res.send(`Admin created.<br>Email: ${email}<br>Password: ${password}`);
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port", PORT);
});
