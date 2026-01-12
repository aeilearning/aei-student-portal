const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

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
// TEMP DATA (IN-MEMORY)
// --------------------
const users = [
  { email: "cam@aeilearning.com", role: "admin" },
];

// Statuses
const STATUS_OPTIONS = [
  "Pending enrollment",
  "Currently enrolled in class",
  "Completed level",
  "Pending re-enrollment",
  "Paused",
  "Dropped class",
  "Dropped program",
];

// Student storage
const students = [];

// Student ID counter (starts at 001000)
let studentIdCounter = 1000;

// --------------------
// HELPERS
// --------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Admin only.");
  }
  next();
}

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function nextStudentId() {
  const id = String(studentIdCounter).padStart(6, "0");
  studentIdCounter++;
  return id;
}

// --------------------
// ROUTES
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  res.send("Student portal coming soon.");
});

// --------------------
// AUTH
// --------------------
app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Learning Portal Login</h2>
    <form method="POST" action="/login">
      <input type="email" name="email" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  const user = users.find(u => u.email === email);
  if (!user) return res.send("User not found.");
  req.session.user = user;
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --------------------
// ADMIN DASHBOARD
// --------------------
app.get("/admin", requireAdmin, (req, res) => {
  const rows = students.map(s => `
    <tr>
      <td>${esc(s.studentId)}</td>
      <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
      <td>${esc(s.email)}</td>
      <td>${esc(s.level)}</td>
      <td>${esc(s.yearEnrolled)}</td>
      <td>
        <form method="POST" action="/admin/students/${s.studentId}/status">
          <select name="status" onchange="this.form.submit()">
            ${STATUS_OPTIONS.map(opt =>
              `<option ${opt === s.status ? "selected" : ""}>${opt}</option>`
            ).join("")}
          </select>
        </form>
      </td>
    </tr>
  `).join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Logged in as: ${esc(req.session.user.email)}</p>
    <a href="/logout">Logout</a>

    <h2>Add Student</h2>
    <form method="POST" action="/admin/students">
      <input name="firstName" placeholder="First name" />
      <input name="lastName" placeholder="Last name" />
      <input name="email" placeholder="Email" required />
      <input name="yearEnrolled" placeholder="Year enrolled (e.g. 2025)" />
      <select name="level">
        <option>1</option>
        <option>2</option>
        <option>3</option>
        <option>4</option>
      </select>
      <select name="status">
        ${STATUS_OPTIONS.map(s => `<option>${s}</option>`).join("")}
      </select>
      <button>Add</button>
    </form>

    <h2>Students</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>ID</th>
        <th>Name</th>
        <th>Email</th>
        <th>Level</th>
        <th>Year Enrolled</th>
        <th>Status</th>
      </tr>
      ${rows || "<tr><td colspan='6'>No students</td></tr>"}
    </table>
  `);
});

// --------------------
// ADMIN ACTIONS
// --------------------
app.post("/admin/students", requireAdmin, (req, res) => {
  students.push({
    studentId: nextStudentId(),
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email: req.body.email || "",
    level: Number(req.body.level || 1),
    yearEnrolled: req.body.yearEnrolled || "",
    status: req.body.status || "Pending enrollment",
  });
  res.redirect("/admin");
});

app.post("/admin/students/:id/status", requireAdmin, (req, res) => {
  const student = students.find(s => s.studentId === req.params.id);

  if (student && STATUS_OPTIONS.includes(req.body.status)) {
    student.status = req.body.status;

    // Auto-advance logic
    if (req.body.status === "Completed level") {
      if (student.level < 4) {
        student.level += 1;
        student.status = "Pending re-enrollment";
      }
    }
  }

  res.redirect("/admin");
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
