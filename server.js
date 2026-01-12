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
// TEMP DATA
// --------------------
const users = [
  { email: "cam@aeilearning.com", role: "admin" },
];

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
    .replaceAll(">", "&gt;");
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
      <td>${esc(s.id)}</td>
      <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
      <td>${esc(s.email)}</td>
      <td>${esc(s.level)}</td>
      <td>${esc(s.status)}</td>
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
      <select name="level">
        <option>1</option><option>2</option><option>3</option><option>4</option>
      </select>
      <select name="status">
        ${STATUS_OPTIONS.map(s => `<option>${s}</option>`).join("")}
      </select>
      <button>Add</button>
    </form>

    <h2>Students</h2>
    <table border="1">
      <tr><th>ID</th><th>Name</th><th>Email</th><th>Level</th><th>Status</th></tr>
      ${rows || "<tr><td colspan='5'>No students</td></tr>"}
    </table>
  `);
});

app.post("/admin/students", requireAdmin, (req, res) => {
  students.push({
    id: newId(),
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email: req.body.email || "",
    level: req.body.level || "1",
    status: req.body.status || STATUS_OPTIONS[0],
  });
  res.redirect("/admin");
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
