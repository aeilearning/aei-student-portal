const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- DATABASE ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ---------- APP SETUP ---------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

/* ---------- AUTH HELPERS ---------- */
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  next();
}

/* ---------- ROUTES ---------- */
app.get("/", (req, res) => {
  res.send(`
    <h1>AEI Student Portal</h1>
    <p><a href="/login">Admin Login</a></p>
  `);
});

/* ---------- LOGIN ---------- */
app.get("/login", (req, res) => {
  res.send(`
    <h1>Admin Login</h1>
    <form method="POST">
      <input name="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM admins WHERE email=$1",
    [email]
  );

  if (!result.rows.length) {
    return res.send("Invalid login");
  }

  const admin = result.rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);

  if (!ok) {
    return res.send("Invalid login");
  }

  req.session.user = { id: admin.id, role: "admin" };
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ---------- ONE-TIME ADMIN BOOTSTRAP ---------- */
/* VISIT /setup-admin ONCE, THEN DELETE THIS ROUTE */
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

  res.send(`
    Admin created.<br/>
    Email: ${email}<br/>
    Password: ${password}<br/>
    DELETE THIS ROUTE NOW.
  `);
});

/* ---------- ADMIN DASHBOARD ---------- */
app.get("/admin", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM students ORDER BY id ASC"
  );

  const rowsHtml = rows.map(s => `
    <tr>
      <td>${s.student_id}</td>
      <td>
        <form method="POST" action="/admin/update/${s.id}">
          <select name="status">
            ${STATUSES.map(v =>
              `<option ${v === s.status ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
      </td>
      <td>${s.first_name || ""}</td>
      <td>${s.last_name || ""}</td>
      <td>
          <select name="level">
            ${LEVELS.map(v =>
              `<option ${v === s.level ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
      </td>
      <td>${s.email || ""}</td>
      <td>
          <button>Save</button>
        </form>
      </td>
      <td>
        <form method="POST" action="/admin/delete/${s.id}">
          <button onclick="return confirm('Delete student?')">X</button>
        </form>
      </td>
    </tr>
  `).join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p><a href="/logout">Logout</a></p>

    <h2>Add Student</h2>
    <form method="POST" action="/admin/add">
      <input name="first_name" placeholder="First name" />
      <input name="last_name" placeholder="Last name" />
      <input name="email" placeholder="Email" />
      <button>Add</button>
    </form>

    <table border="1" cellpadding="5">
      <tr>
        <th>ID</th>
        <th>Status</th>
        <th>First</th>
        <th>Last</th>
        <th>Level</th>
        <th>Email</th>
        <th>Save</th>
        <th>Delete</th>
      </tr>
      ${rowsHtml}
    </table>
  `);
});

app.post("/admin/add", requireAdmin, async (req, res) => {
  const nextId = await pool.query(
    "SELECT COALESCE(MAX(student_id::int), 999) + 1 AS next FROM students"
  );

  const studentId = String(nextId.rows[0].next).padStart(6, "0");

  await pool.query(
    `INSERT INTO students
     (student_id, status, level, first_name, last_name, email, enrollment_date)
     VALUES ($1,'Pending Enrollment','1',$2,$3,$4,CURRENT_DATE)`,
    [studentId, req.body.first_name, req.body.last_name, req.body.email]
  );

  res.redirect("/admin");
});

app.post("/admin/update/:id", requireAdmin, async (req, res) => {
  await pool.query(
    `UPDATE students SET status=$1, level=$2 WHERE id=$3`,
    [req.body.status, req.body.level, req.params.id]
  );
  res.redirect("/admin");
});

app.post("/admin/delete/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM students WHERE id=$1", [req.params.id]);
  res.redirect("/admin");
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port", PORT);
});
