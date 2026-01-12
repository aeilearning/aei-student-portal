const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// If you're behind Render/any proxy, this makes secure cookies work correctly
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "aei-secret-temp-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // Render = production
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
    },
  })
);

// --------------------
// TEMP DATA (IN-MEMORY) — will reset on redeploy/restart
// --------------------
const users = [{ email: "cam@aeilearning.com", role: "admin" }];

const STATUS_OPTIONS = [
  "Currently enrolled in class",
  "Paused",
  "Dropped class",
  "Dropped program",
];

const students = [];

// --------------------
// HELPERS
// --------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.status(403).send("Admin only.");
  next();
}

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function newId() {
  return "S" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// --------------------
// ROUTES
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  res.send("User portal coming soon.");
});

// --------------------
// AUTH
// --------------------
app.get("/login", (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>AEI Learning Portal Login</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    .card { max-width: 520px; border: 1px solid #ddd; border-radius: 10px; padding: 18px; }
    input { padding: 10px; width: 100%; margin: 8px 0 12px; }
    button { padding: 10px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>AEI Learning Portal Login</h2>
    <form method="POST" action="/login">
      <label>Email</label>
      <input type="email" name="email" required />
      <button type="submit">Login</button>
    </form>
    <p style="color:#666; margin-top:12px;">
      (Temporary login: enter <b>cam@aeilearning.com</b>)
    </p>
  </div>
</body>
</html>
  `);
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(401).send("User not found.");
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
  const rows = students
    .map(
      (s) => `
<tr>
  <td>${esc(s.id)}</td>
  <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
  <td>${esc(s.email)}</td>
  <td>${esc(s.level)}</td>
  <td>
    <form method="POST" action="/admin/students/${s.id}/status">
      <select name="status" onchange="this.form.submit()">
        ${STATUS_OPTIONS.map(
          (opt) => `<option value="${esc(opt)}" ${opt === s.status ? "selected" : ""}>${esc(opt)}</option>`
        ).join("")}
      </select>
    </form>
  </td>
</tr>
`
    )
    .join("");

  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Admin Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    h1 { margin: 0 0 8px; }
    .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    .muted { color:#666; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; margin: 14px 0; }
    input, select { padding: 10px; margin-right: 8px; }
    button { padding: 10px 14px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    .row { display:flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .row input { width: 180px; }
    .row input[type="email"] { width: 240px; }
  </style>
</head>
<body>

  <div class="top">
    <div>
      <h1>Admin Dashboard</h1>
      <div class="muted">Logged in as: ${esc(req.session.user.email)}</div>
    </div>
    <div><a href="/logout">Logout</a></div>
  </div>

  <div class="card">
    <h2>Add Student</h2>
    <form method="POST" action="/admin/students">
      <div class="row">
        <input name="firstName" placeholder="First name" />
        <input name="lastName" placeholder="Last name" />
        <input type="email" name="email" placeholder="Email" required />
        <select name="level">
          <option>1</option><option>2</option><option>3</option><option>4</option>
        </select>
        <select name="status">
          ${STATUS_OPTIONS.map((opt) => `<option value="${esc(opt)}">${esc(opt)}</option>`).join("")}
        </select>
        <button type="submit">Add</button>
      </div>
    </form>
  </div>

  <div class="card">
    <h2>Students</h2>
    <table>
      <tr>
        <th>ID</th><th>Name</th><th>Email</th><th>Level</th><th>Status</th>
      </tr>
      ${rows || `<tr><td colspan="5" class="muted">No students</td></tr>`}
    </table>
    <p class="muted" style="margin-top:10px;">
      Note: this is temporary in-memory data. It will reset if the service restarts.
    </p>
  </div>

</body>
</html>
  `);
});

// --------------------
// ADMIN ACTIONS
// --------------------
app.post("/admin/students", requireAdmin, (req, res) => {
  students.push({
    id: newId(),
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email: (req.body.email || "").toLowerCase().trim(),
    level: req.body.level || "1",
    status: req.body.status || STATUS_OPTIONS[0],
  });
  res.redirect("/admin");
});

app.post("/admin/students/:id/status", requireAdmin, (req, res) => {
  const student = students.find((s) => s.id === req.params.id);
  const nextStatus = req.body.status;
  if (student && STATUS_OPTIONS.includes(nextStatus)) {
    student.status = nextStatus;
  }
  res.redirect("/admin");
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
