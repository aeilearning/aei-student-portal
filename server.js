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
// TEMP DATA (we will move to a database next)
// --------------------
const users = [
  { email: "cam@aeilearning.com", role: "admin" }, // you
];

// Student statuses you requested
const STATUS_OPTIONS = [
  "Currently enrolled in class",
  "Paused",
  "Dropped class",
  "Dropped program",
];

// TEMP student list
const students = []; // {id, firstName, lastName, email, state, employed, apprenticeNumber, level, status, createdAt}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.status(403).send("Admin only.");
  next();
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nextStudentId() {
  return "S" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// --------------------
// ROUTES
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  return res.redirect("/me");
});

app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Learning Portal Login</h2>
    <p>Enter your email to log in (starter mode).</p>
    <form method="POST" action="/login">
      <input type="email" name="email" placeholder="Email" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.send(`
      <h3>User not found</h3>
      <p>This is normal right now. Only admin is enabled.</p>
      <p>Email entered: <b>${escapeHtml(email)}</b></p>
      <a href="/login">Back</a>
    `);
  }

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
    .map(s => {
      const name = `${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}`.trim();
      return `
        <tr>
          <td><a href="/admin/students/${encodeURIComponent(s.id)}">${escapeHtml(s.id)}</a></td>
          <td>${name || "(no name yet)"}</td>
          <td>${escapeHtml(s.email)}</td>
          <td>${escapeHtml(s.state)}</td>
          <td>${s.employed ? "Yes" : "No"}</td>
          <td>${escapeHtml(s.level)}</td>
          <td>${escapeHtml(s.status)}</td>
        </tr>
      `;
    })
    .join("");

  const statusOptionsHtml = STATUS_OPTIONS.map(
    opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`
  ).join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Logged in as: <b>${escapeHtml(req.session.user.email)}</b> (<b>${escapeHtml(req.session.user.role)}</b>)</p>
    <p><a href="/logout">Logout</a></p>

    <hr/>

    <h2>Add Student</h2>
    <form method="POST" action="/admin/students">
      <div style="display:grid; gap:8px; max-width:520px;">
        <input name="firstName" placeholder="First name" />
        <input name="lastName" placeholder="Last name" />
        <input name="email" type="email" placeholder="Student email (required)" required />

        <label>State (CO / WY / Other)</label>
        <input name="state" placeholder="CO" value="CO" />

        <label>Currently employed as an apprentice?</label>
        <select name="employed">
          <option value="no" selected>No</option>
          <option value="yes">Yes</option>
        </select>

        <input name="apprenticeNumber" placeholder="Apprentice number (if employed)" />

        <label>Course level (1–4)</label>
        <select name="level" required>
          <option value="1">Level 1</option>
          <option value="2">Level 2</option>
          <option value="3">Level 3</option>
          <option value="4">Level 4</option>
        </select>

        <label>Status</label>
        <select name="status">
          ${statusOptionsHtml}
        </select>

        <button type="submit">Create Student</button>
      </div>
    </form>

    <hr/>

    <h2>Students (${students.length})</h2>
    <table border="1" cellpadding="8" cellspacing="0">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Email</th>
          <th>State</th>
          <th>Employed</th>
          <th>Level</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="7">(No students yet)</td></tr>`}
      </tbody>
    </table>

    <p style="margin-top:16px;color:#666;">
      Note: This dashboard is running in "starter mode" (temporary memory).
      Next step is a real database so nothing ever resets.
    </p>
  `);
});

app.post("/admin/students", requireAdmin, (req, res) => {
  const firstName = (req.body.firstName || "").trim();
  const lastName = (req.body.lastName || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  const state = (req.body.state || "CO").trim().toUpperCase() || "CO";
  const employed = (req.body.employed || "no") === "yes";
  const apprenticeNumber = (req.body.apprenticeNumber || "").trim();

  const level = String(req.body.level || "1").trim();
  const status = (req.body.status || STATUS_OPTIONS[0]).trim();

  const id = nextStudentId();

  students.push({
    id,
    firstName,
    lastName,
    email,
    state,
    employed,
    apprenticeNumber,
    level,
    status,
    createdAt: new Date().toISOString(),
  });

  res.redirect("/admin");
});

app.get("/admin/students/:id", requireAdmin, (req, res) => {
  const student = students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).send("Student not found.");

  const statusOptionsHtml = STATUS_OPTIONS.map(opt => {
    const sel = opt === student.status ? "selected" : "";
    return `<option value="${escapeHtml(opt)}" ${sel}>${escapeHtml(opt)}</option>`;
  }).join("");

  res.send(`
    <h1>Student Record</h1>
    <p><a href="/admin">← Back to Admin Dashboard</a></p>

    <h2>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h2>
    <p><b>ID:</b> ${escapeHtml(student.id)}</p>
    <p><b>Email:</b> ${escapeHtml(student.email)}</p>
    <p><b>State:</b> ${escapeHtml(student.state)}</p>
    <p><b>Employed:</b> ${student.employed ? "Yes" : "No"}</p>
    <p><b>Apprentice #:</b> ${escapeHtml(student.apprenticeNumber || "(none)")}</p>
    <p><b>Level:</b> ${escapeHtml(student.level)}</p>
    <p><b>Status:</b> ${escapeHtml(student.status)}</p>

    <hr/>

    <h3>Update Status</h3>
    <form method="POST" action="/admin/students/${encodeURIComponent(student.id)}/status">
      <select name="status">
        ${statusOptionsHtml}
      </select>
      <button type="submit">Save</button>
    </form>

    <p style="margin-top:16px;color:#666;">
      Next we’ll add: enrollment checklist, payment auth, NEC book question, documents, and RAPIDS export fields.
    </p>
  `);
});

app.post("/admin/students/:id/status", requireAdmin, (req, res) => {
  const student = students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).send("Student not found.");

  const status = (req.body.status || "").trim();
  if (STATUS_OPTIONS.includes(status)) {
    student.status = status;
  }
  res.redirect(`/admin/students/${encodeURIComponent(student.id)}`);
});

// --------------------
// NON-ADMIN PLACEHOLDER
// --------------------
app.get("/me", requireLogin, (req, res) => {
  res.send(`
    <h1>Portal</h1>
    <p>You are logged in as ${escapeHtml(req.session.user.email)}.</p>
    <p>This is where student/employer views will go.</p>
    <a href="/logout">Logout</a>
  `);
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`AEI portal running on port ${PORT}`);
});
    <p>Logged in as: ${email}</p>
    <p>Role: ${role}</p>

    ${role === "admin" ? "<p>Admin controls will go here.</p>" : ""}
    ${role === "student" ? "<p>Student enrollment will go here.</p>" : ""}
    ${role === "employer" ? "<p>Employer actions will go here.</p>" : ""}

    <a href="/logout">Logout</a>
  `);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`AEI portal running on port ${PORT}`);
});
