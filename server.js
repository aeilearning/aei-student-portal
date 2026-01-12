const express = require("express");
const session = require("express-session");
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
    secret: process.env.SESSION_SECRET || "dev-secret",
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

/* ---------- AUTH (TEMP ADMIN) ---------- */
app.use((req, res, next) => {
  // TEMP: auto-admin until real auth is added
  req.session.user = { role: "admin", email: "admin@aei.local" };
  next();
});

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
}
initDb();

/* ---------- ROUTES ---------- */
app.get("/admin", async (req, res) => {
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
      <td>${s.enrollment_date || ""}</td>
      <td>${s.state_license || ""}</td>
      <td>${s.rapids || ""}</td>
      <td>${s.employer || ""}</td>
      <td>${s.phone || ""}</td>
      <td>${s.email || ""}</td>
      <td>${s.address || ""}</td>
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

    <h2>Add Student (basic)</h2>
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
        <th>Enrolled</th>
        <th>State License #</th>
        <th>RAPIDS #</th>
        <th>Employer</th>
        <th>Phone</th>
        <th>Email</th>
        <th>Address</th>
        <th>Save</th>
        <th>Delete</th>
      </tr>
      ${rowsHtml}
    </table>
  `);
});

app.post("/admin/add", async (req, res) => {
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

app.post("/admin/update/:id", async (req, res) => {
  await pool.query(
    `UPDATE students SET status=$1, level=$2 WHERE id=$3`,
    [req.body.status, req.body.level, req.params.id]
  );
  res.redirect("/admin");
});

app.post("/admin/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM students WHERE id=$1", [req.params.id]);
  res.redirect("/admin");
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port", PORT);
});
