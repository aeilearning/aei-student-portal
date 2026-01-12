const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "aei.db");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: "aei-secret-temp",
    resave: false,
    saveUninitialized: false,
  })
);

// --------------------
// DATABASE
// --------------------
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      status TEXT,
      first_name TEXT,
      last_name TEXT,
      level INTEGER,
      enrollment_date TEXT,
      state_license TEXT,
      rapids TEXT,
      employer TEXT,
      phone TEXT,
      email TEXT,
      address TEXT
    )
  `);
});

// --------------------
// AUTH
// --------------------
const users = [{ email: "cam@aeilearning.com", role: "admin" }];

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.sendStatus(403);
  next();
}

function newId() {
  return Date.now().toString().slice(-6);
}

const STATUS_OPTIONS = [
  "Pending enrollment",
  "Currently enrolled",
  "Paused",
  "Dropped class",
  "Dropped program",
];

// --------------------
// ROUTES
// --------------------
app.get("/login", (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="POST">
      <input name="email" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const user = users.find(u => u.email === req.body.email);
  if (!user) return res.send("Unauthorized");
  req.session.user = user;
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --------------------
// ADMIN DASHBOARD
// --------------------
app.get("/admin", requireAdmin, (req, res) => {
  db.all(`SELECT * FROM students`, (err, students) => {
    const rows = students.map(s => `
      <tr>
        <td>${s.id}</td>

        <td>
          <form method="POST" action="/update-status">
            <input type="hidden" name="id" value="${s.id}">
            <select name="status" onchange="this.form.submit()">
              ${STATUS_OPTIONS.map(o =>
                `<option ${o === s.status ? "selected" : ""}>${o}</option>`
              ).join("")}
            </select>
          </form>
        </td>

        <td>${s.first_name}</td>
        <td>${s.last_name}</td>

        <td>
          <form method="POST" action="/update-level">
            <input type="hidden" name="id" value="${s.id}">
            <select name="level" onchange="this.form.submit()">
              ${[1,2,3,4].map(l =>
                `<option ${l === s.level ? "selected" : ""}>${l}</option>`
              ).join("")}
            </select>
          </form>
        </td>

        <td>${s.enrollment_date || ""}</td>
        <td>${s.state_license || ""}</td>
        <td>${s.rapids || ""}</td>
        <td>${s.employer || ""}</td>
        <td>${s.phone || ""}</td>

        <td contenteditable="true"
            onblur="updateField('${s.id}','email',this.innerText)">
          ${s.email || ""}
        </td>

        <td contenteditable="true"
            onblur="updateField('${s.id}','address',this.innerText)">
          ${s.address || ""}
        </td>

        <td>
          <form method="POST" action="/delete">
            <input type="hidden" name="id" value="${s.id}">
            <button onclick="return confirm('Delete student?')">❌</button>
          </form>
        </td>
      </tr>
    `).join("");

    res.send(`
      <h1>Admin Dashboard</h1>
      <a href="/logout">Logout</a>

      <h2>Add Student</h2>
      <form method="POST" action="/add">
        <input name="first_name" placeholder="First name" required>
        <input name="last_name" placeholder="Last name" required>
        <input name="email" placeholder="Email">
        <input name="enrollment_date" placeholder="Enrollment date">
        <button>Add</button>
      </form>

      <table border="1" cellpadding="6">
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
          <th>Delete</th>
        </tr>
        ${rows}
      </table>

      <script>
        function updateField(id, field, value) {
          fetch('/update-field', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, field, value})
          });
        }
      </script>
    `);
  });
});

// --------------------
// ACTIONS
// --------------------
app.post("/add", requireAdmin, (req, res) => {
  db.run(
    `INSERT INTO students VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      newId(),
      "Pending enrollment",
      req.body.first_name,
      req.body.last_name,
      1,
      req.body.enrollment_date,
      "", "", "", "", req.body.email, ""
    ],
    () => res.redirect("/admin")
  );
});

app.post("/update-status", requireAdmin, (req, res) => {
  db.run(`UPDATE students SET status=? WHERE id=?`,
    [req.body.status, req.body.id],
    () => res.redirect("/admin")
  );
});

app.post("/update-level", requireAdmin, (req, res) => {
  db.run(`UPDATE students SET level=? WHERE id=?`,
    [req.body.level, req.body.id],
    () => res.redirect("/admin")
  );
});

app.post("/update-field", requireAdmin, (req, res) => {
  db.run(
    `UPDATE students SET ${req.body.field}=? WHERE id=?`,
    [req.body.value, req.body.id],
    () => res.sendStatus(200)
  );
});

app.post("/delete", requireAdmin, (req, res) => {
  db.run(`DELETE FROM students WHERE id=?`, [req.body.id], () =>
    res.redirect("/admin")
  );
});

// --------------------
app.listen(PORT, () =>
  console.log("AEI portal running on port", PORT)
);
