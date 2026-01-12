const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "aei-secret-temp-change-me",
    resave: false,
    saveUninitialized: false,
  })
);

// --------------------
// IN-MEMORY DATA (TEMP)
// --------------------

// Admin users (temp, email-only login)
const adminUsers = [{ email: "cam@aeilearning.com", role: "admin" }];

// Statuses
const STATUS_OPTIONS = [
  "Pending enrollment",
  "Currently enrolled in class",
  "Pending re-enrollment",
  "Paused",
  "Dropped class",
  "Dropped program",
];

// Students (in-memory for now)
const students = [];

// Student ID counter (starts at 001000)
let nextStudentNumber = 1000; // 001000

// --------------------
// HELPERS
// --------------------
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatStudentId(num) {
  // 6 digits, zero-padded
  return String(num).padStart(6, "0");
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.status(403).send("Admin only.");
  next();
}

function requireStudent(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "student") return res.status(403).send("Students only.");
  next();
}

// --------------------
// ROUTES
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  if (req.session.user.role === "student") return res.redirect("/portal");
  return res.redirect("/login");
});

// --------------------
// AUTH
// --------------------
app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Learning Portal Login</h2>
    <p style="max-width:700px;">
      <b>Admin:</b> use your email.<br/>
      <b>Students:</b> enter the email you were added under.
    </p>

    <form method="POST" action="/login" style="display:flex; gap:8px; align-items:center;">
      <input type="email" name="email" placeholder="Email" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();

  // Admin?
  const admin = adminUsers.find((u) => u.email === email);
  if (admin) {
    req.session.user = admin;
    return res.redirect("/");
  }

  // Student?
  const student = students.find((s) => s.email.toLowerCase() === email);
  if (student) {
    req.session.user = { email, role: "student", studentId: student.id };
    return res.redirect("/portal");
  }

  return res.send(`
    <p>User not found.</p>
    <p><a href="/login">Back</a></p>
  `);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --------------------
// STUDENT PORTAL (BASIC PLACEHOLDER)
// --------------------
app.get("/portal", requireStudent, (req, res) => {
  const s = students.find((x) => x.id === req.session.user.studentId);
  if (!s) return res.redirect("/logout");

  const needsEnrollment = s.status === "Pending enrollment";
  const needsReEnroll = s.status === "Pending re-enrollment";

  res.send(`
    <h1>Student Portal</h1>
    <p><b>Student ID:</b> ${esc(s.id)}</p>
    <p><b>Name:</b> ${esc(s.firstName)} ${esc(s.lastName)}</p>
    <p><b>Email:</b> ${esc(s.email)}</p>
    <p><b>Level:</b> ${esc(s.level)}</p>
    <p><b>Year Enrolled:</b> ${esc(String(s.yearEnrolled || ""))}</p>
    <p><b>Status:</b> ${esc(s.status)}</p>

    <p><a href="/logout">Logout</a></p>

    ${needsEnrollment ? `
      <hr/>
      <h2>Finish Enrollment</h2>
      <p>
        Right now this is a placeholder. Next step is the real multi-stage enrollment wizard
        (contact info → employment → RAPIDS logic → payment authorization → materials → docs).
      </p>
      <form method="POST" action="/portal/finish-enrollment">
        <button type="submit">Finish Enrollment (placeholder)</button>
      </form>
    ` : ""}

    ${needsReEnroll ? `
      <hr/>
      <h2>Re-enrollment Needed</h2>
      <p>
        You completed a level. Your status is <b>Pending re-enrollment</b> until the next enrollment steps are completed.
      </p>
      <form method="POST" action="/portal/finish-reenroll">
        <button type="submit">Complete Re-enrollment (placeholder)</button>
      </form>
    ` : ""}

  `);
});

app.post("/portal/finish-enrollment", requireStudent, (req, res) => {
  const s = students.find((x) => x.id === req.session.user.studentId);
  if (!s) return res.redirect("/logout");

  // Placeholder: once wizard exists, this flips only when all required steps completed
  if (s.status === "Pending enrollment") {
    s.status = "Currently enrolled in class";
  }
  res.redirect("/portal");
});

app.post("/portal/finish-reenroll", requireStudent, (req, res) => {
  const s = students.find((x) => x.id === req.session.user.studentId);
  if (!s) return res.redirect("/logout");

  // Placeholder: once wizard exists, this flips only when reenrollment steps completed
  if (s.status === "Pending re-enrollment") {
    s.status = "Currently enrolled in class";
  }
  res.redirect("/portal");
});

// --------------------
// ADMIN DASHBOARD
// --------------------
app.get("/admin", requireAdmin, (req, res) => {
  const rows = students
    .map((s) => {
      return `
        <tr>
          <td>${esc(s.id)}</td>
          <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
          <td>${esc(s.email)}</td>
          <td>${esc(s.level)}</td>
          <td>${esc(s.status)}</td>
          <td>${esc(String(s.yearEnrolled || ""))}</td>

          <td>
            <form method="POST" action="/admin/students/${encodeURIComponent(s.id)}/status" style="display:flex; gap:6px; align-items:center;">
              <select name="status">
                ${STATUS_OPTIONS.map((opt) => `<option ${opt === s.status ? "selected" : ""}>${esc(opt)}</option>`).join("")}
              </select>
              <button type="submit">Save</button>
            </form>
          </td>

          <td>
            <form method="POST" action="/admin/students/${encodeURIComponent(s.id)}/year" style="display:flex; gap:6px; align-items:center;">
              <input name="yearEnrolled" value="${esc(String(s.yearEnrolled || ""))}" placeholder="YYYY" style="width:90px;" />
              <button type="submit">Save</button>
            </form>
          </td>

          <td>
            <form method="POST" action="/admin/students/${encodeURIComponent(s.id)}/complete-level">
              <button type="submit">Complete Level</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Logged in as: <b>${esc(req.session.user.email)}</b></p>
    <p><a href="/logout">Logout</a></p>

    <hr/>

    <h2>Add Student</h2>
    <form method="POST" action="/admin/students" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <input name="firstName" placeholder="First name" />
      <input name="lastName" placeholder="Last name" />
      <input name="email" placeholder="Email (required)" required />
      <select name="level">
        <option>1</option><option>2</option><option>3</option><option>4</option>
      </select>

      <select name="status">
        ${STATUS_OPTIONS.map((st) => `<option ${st === "Pending enrollment" ? "selected" : ""}>${esc(st)}</option>`).join("")}
      </select>

      <input name="yearEnrolled" placeholder="Year enrolled (YYYY)" style="width:150px;" />
      <button type="submit">Add</button>
    </form>

    <hr/>

    <h2>Students</h2>
    <table border="1" cellpadding="6" style="border-collapse:collapse;">
      <tr>
        <th>ID</th>
        <th>Name</th>
        <th>Email</th>
        <th>Level</th>
        <th>Status</th>
        <th>Year Enrolled</th>
        <th>Change Status</th>
        <th>Edit Year</th>
        <th>Progression</th>
      </tr>
      ${rows || "<tr><td colspan='9'>No students yet</td></tr>"}
    </table>

    <p style="margin-top:16px; max-width:900px;">
      <b>Note:</b> “Complete Level” is the placeholder for the moment that you issue the certificate/transcript.
      In the next batch, that button will generate the PDFs and then run the same progression automatically.
    </p>
  `);
});

// --------------------
// ADMIN ACTIONS
// --------------------
app.post("/admin/students", requireAdmin, (req, res) => {
  const id = formatStudentId(nextStudentNumber++);
  const yearDefault = new Date().getFullYear();

  const yearEnrolledRaw = String(req.body.yearEnrolled || "").trim();
  const yearEnrolled =
    /^\d{4}$/.test(yearEnrolledRaw) ? yearEnrolledRaw : String(yearDefault);

  students.push({
    id,
    firstName: String(req.body.firstName || "").trim(),
    lastName: String(req.body.lastName || "").trim(),
    email: String(req.body.email || "").trim(),
    level: String(req.body.level || "1"),
    status: STATUS_OPTIONS.includes(req.body.status) ? req.body.status : "Pending enrollment",
    yearEnrolled,
  });

  res.redirect("/admin");
});

app.post("/admin/students/:id/status", requireAdmin, (req, res) => {
  const student = students.find((s) => s.id === req.params.id);
  if (student && STATUS_OPTIONS.includes(req.body.status)) {
    student.status = req.body.status;
  }
  res.redirect("/admin");
});

app.post("/admin/students/:id/year", requireAdmin, (req, res) => {
  const student = students.find((s) => s.id === req.params.id);
  if (!student) return res.redirect("/admin");

  const y = String(req.body.yearEnrolled || "").trim();
  // allow blank, or 4-digit year
  if (y === "" || /^\d{4}$/.test(y)) {
    student.yearEnrolled = y;
  }

  res.redirect("/admin");
});

app.post("/admin/students/:id/complete-level", requireAdmin, (req, res) => {
  const student = students.find((s) => s.id === req.params.id);
  if (!student) return res.redirect("/admin");

  // Placeholder for: certificate + transcript generation moment.
  // When that module exists, it will call this same logic after PDFs are generated.
  const currentLevel = parseInt(student.level, 10);
  if (!Number.isNaN(currentLevel) && currentLevel >= 1 && currentLevel < 4) {
    student.level = String(currentLevel + 1);
  }
  // After completion, force re-enrollment workflow
  student.status = "Pending re-enrollment";

  res.redirect("/admin");
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
