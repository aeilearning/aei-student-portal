const express = require("express");
const session = require("express-session");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: "aei-prod-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// --------------------
// AUTH (TEMP SIMPLE)
// --------------------
const users = [{ email: "cam@aeilearning.com", role: "admin" }];

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.sendStatus(403);
  next();
}

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function newId() {
  return "S" + Date.now().toString(36);
}

// --------------------
// AUTH ROUTES
// --------------------
app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Admin Login</h2>
    <form method="POST">
      <input name="email" type="email" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const user = users.find(u => u.email === req.body.email.toLowerCase());
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
  db.all(`SELECT * FROM students ORDER BY last_name`, (err, rows) => {
    const tableRows = rows.map(s => `
      <tr>
        <td>${esc(s.id)}</td>
        <td>${esc(s.first_name)}</td>
        <td>${esc(s.last_name)}</td>

        <td>
          <form method="POST" action="/admin/update/${s.id}">
            <input name="level" value="${esc(s.level)}" size="2"/>
        </td>

        <td>
            <input name="status" value="${esc(s.status)}"/>
        </td>

        <td>${esc(s.original_enrollment_date)}</td>
        <td>${esc(s.state_license_number)}</td>
        <td>${esc(s.rapids_number)}</td>
        <td>${esc(s.employer)}</td>
        <td>${esc(s.phone)}</td>

        <td>
            <input name="email" value="${esc(s.email)}"/>
        </td>

        <td>
            <input name="home_address" value="${esc(s.home_address)}"/>
        </td>

        <td>
            <button>Save</button>
          </form>
        </td>

        <td>
          <form method="POST" action="/admin/delete/${s.id}" onsubmit="return confirm('Delete student permanently?')">
            <button>DELETE</button>
          </form>
        </td>
      </tr>
    `).join("");

    res.send(`
      <h1>AEI Student Administration</h1>
      <a href="/logout">Logout</a>

      <h2>Add Student</h2>
      <form method="POST" action="/admin/add">
        <input name="first_name" placeholder="First name" required />
        <input name="last_name" placeholder="Last name" required />
        <input name="level" placeholder="Level" required />
        <input name="status" placeholder="Status" />
        <input name="original_enrollment_date" placeholder="Enrollment date" />
        <input name="state_license_number" placeholder="State License #" />
        <input name="rapids_number" placeholder="RAPIDS #" />
        <input name="employer" placeholder="Employer" />
        <input name="phone" placeholder="Phone" />
        <input name="email" placeholder="Email" />
        <input name="home_address" placeholder="Home Address" />
        <button>Add Student</button>
      </form>

      <h2>Students</h2>
      <table border="1" cellpadding="4">
        <tr>
          <th>ID</th>
          <th>First</th>
          <th>Last</th>
          <th>Level</th>
          <th>Status</th>
          <th>Enroll Date</th>
          <th>State Lic #</th>
          <th>RAPIDS #</th>
          <th>Employer</th>
          <th>Phone</th>
          <th>Email</th>
          <th>Address</th>
          <th>Save</th>
          <th>Delete</th>
        </tr>
        ${tableRows || "<tr><td colspan='14'>No students</td></tr>"}
      </table>
    `);
  });
});

// --------------------
// ACTIONS
// --------------------
app.post("/admin/add", requireAdmin, (req, res) => {
  const s = req.body;
  db.run(
    `INSERT INTO students VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      s.first_name,
      s.last_name,
      s.level,
      s.status,
      s.original_enrollment_date,
      s.state_license_number,
      s.rapids_number,
      s.employer,
      s.phone,
      s.email,
      s.home_address
    ],
    () => res.redirect("/admin")
  );
});

app.post("/admin/update/:id", requireAdmin, (req, res) => {
  const s = req.body;
  db.run(
    `UPDATE students SET
      level = ?,
      status = ?,
      email = ?,
      home_address = ?
     WHERE id = ?`,
    [s.level, s.status, s.email, s.home_address, req.params.id],
    () => res.redirect("/admin")
  );
});

app.post("/admin/delete/:id", requireAdmin, (req, res) => {
  db.run(`DELETE FROM students WHERE id = ?`, [req.params.id], () =>
    res.redirect("/admin")
  );
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
