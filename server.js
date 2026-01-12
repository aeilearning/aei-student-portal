const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
  })
);

// --------------------
// TEMP DATA (IN-MEMORY)
// NOTE: This resets on deploy. Next step is database + Render disk.
// --------------------
const users = [
  { email: "cam@aeilearning.com", role: "admin" },
];

const STATUS_OPTIONS = [
  "Pending enrollment",
  "Currently enrolled in class",
  "Paused",
  "Dropped class",
  "Dropped program",
];

const students = [];  // student records
const employers = []; // employer records

// --------------------
// HELPERS
// --------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.status(403).send("Access denied.");
    next();
  };
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
    .replaceAll('"', "&quot;");
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function findUserByEmail(email) {
  return users.find(u => u.email === email.toLowerCase());
}

// --------------------
// ROUTES - HOME
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  if (req.session.user.role === "student") return res.redirect("/student");
  if (req.session.user.role === "employer") return res.redirect("/employer");
  res.send("Unknown role.");
});

// --------------------
// AUTH - EMAIL ONLY (FOR NOW)
// --------------------
app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Learning Portal Login</h2>
    <p><a href="/register/student">New student? Register here</a></p>
    <p><a href="/register/employer">New employer? Register here</a></p>
    <form method="POST" action="/login">
      <input type="email" name="email" placeholder="Email" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  const user = findUserByEmail(email);
  if (!user) return res.send("User not found. If you're new, register first.");
  req.session.user = user;
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --------------------
// PUBLIC REGISTRATION
// --------------------
app.get("/register/student", (req, res) => {
  res.send(`
    <h2>Student Registration</h2>
    <form method="POST" action="/register/student">
      <input name="firstName" placeholder="First name" required />
      <input name="lastName" placeholder="Last name" required />
      <input type="email" name="email" placeholder="Email" required />
      <input name="phone" placeholder="Phone" />
      <input name="address" placeholder="Address" />
      <input name="employerName" placeholder="Employer (optional)" />
      <button>Create student account</button>
    </form>
    <p><a href="/login">Back to login</a></p>
  `);
});

app.post("/register/student", (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  if (findUserByEmail(email)) return res.send("That email already exists. Go login.");

  const studentId = newId("stu");
  const student = {
    id: studentId,
    role: "student",
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email,
    phone: req.body.phone || "",
    address: req.body.address || "",
    employerName: req.body.employerName || "",
    // admin-controlled:
    level: "",
    status: "Pending enrollment",
    enrollmentDate: "",
    // compliance fields:
    stateLicenseNumber: "",
    rapidsNumber: "",
  };
  students.push(student);
  users.push({ email, role: "student", refId: studentId });

  req.session.user = { email, role: "student", refId: studentId };
  res.redirect("/student");
});

app.get("/register/employer", (req, res) => {
  res.send(`
    <h2>Employer Registration</h2>
    <form method="POST" action="/register/employer">
      <input name="companyName" placeholder="Company name" required />
      <input name="contactName" placeholder="Contact name" required />
      <input type="email" name="email" placeholder="Email" required />
      <input name="phone" placeholder="Phone" />
      <input name="address" placeholder="Business address" />
      <button>Create employer account</button>
    </form>
    <p><a href="/login">Back to login</a></p>
  `);
});

app.post("/register/employer", (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  if (findUserByEmail(email)) return res.send("That email already exists. Go login.");

  const employerId = newId("emp");
  const employer = {
    id: employerId,
    role: "employer",
    companyName: req.body.companyName || "",
    contactName: req.body.contactName || "",
    email,
    phone: req.body.phone || "",
    address: req.body.address || "",
    apprentices: [], // list of student IDs they added/own
  };
  employers.push(employer);
  users.push({ email, role: "employer", refId: employerId });

  req.session.user = { email, role: "employer", refId: employerId };
  res.redirect("/employer");
});

// --------------------
// STUDENT DASHBOARD
// --------------------
app.get("/student", requireRole("student"), (req, res) => {
  const me = students.find(s => s.id === req.session.user.refId);
  if (!me) return res.send("Student record missing.");

  res.send(`
    <h1>Student Dashboard</h1>
    <p>Logged in as: ${esc(me.email)} | <a href="/logout">Logout</a></p>

    <h3>Status</h3>
    <p><b>${esc(me.status || "Pending enrollment")}</b>${me.enrollmentDate ? ` (Enrolled: ${esc(me.enrollmentDate)})` : ""}</p>
    <p>${me.status === "Pending enrollment" ? "Your enrollment is pending review by AEI." : ""}</p>

    <h3>Your Info (you can edit these)</h3>
    <form method="POST" action="/student/profile">
      <label>Phone</label><br/>
      <input name="phone" value="${esc(me.phone)}" /><br/><br/>

      <label>Address</label><br/>
      <input name="address" value="${esc(me.address)}" style="width:420px" /><br/><br/>

      <label>Employer</label><br/>
      <input name="employerName" value="${esc(me.employerName)}" /><br/><br/>

      <label>State License # (if applicable)</label><br/>
      <input name="stateLicenseNumber" value="${esc(me.stateLicenseNumber)}" /><br/><br/>

      <label>RAPIDS # (if applicable)</label><br/>
      <input name="rapidsNumber" value="${esc(me.rapidsNumber)}" /><br/><br/>

      <button>Save</button>
    </form>

    <hr/>
    <p><i>Admin controls Level, Enrollment Date, and Status.</i></p>
  `);
});

app.post("/student/profile", requireRole("student"), (req, res) => {
  const me = students.find(s => s.id === req.session.user.refId);
  if (!me) return res.send("Student record missing.");

  me.phone = req.body.phone || "";
  me.address = req.body.address || "";
  me.employerName = req.body.employerName || "";
  me.stateLicenseNumber = req.body.stateLicenseNumber || "";
  me.rapidsNumber = req.body.rapidsNumber || "";

  res.redirect("/student");
});

// --------------------
// EMPLOYER DASHBOARD
// --------------------
app.get("/employer", requireRole("employer"), (req, res) => {
  const me = employers.find(e => e.id === req.session.user.refId);
  if (!me) return res.send("Employer record missing.");

  const apprenticeRows = (me.apprentices || [])
    .map(id => students.find(s => s.id === id))
    .filter(Boolean)
    .map(s => `
      <tr>
        <td>${esc(s.id)}</td>
        <td>${esc(s.firstName)} ${esc(s.lastName)}</td>
        <td>${esc(s.email)}</td>
        <td>${esc(s.status)}</td>
        <td>${esc(s.level)}</td>
      </tr>
    `).join("");

  res.send(`
    <h1>Employer Dashboard</h1>
    <p>Logged in as: ${esc(me.email)} | <a href="/logout">Logout</a></p>
    <h3>${esc(me.companyName)}</h3>

    <h3>Add Apprentice</h3>
    <p><i>This creates a student account in “Pending enrollment” status.</i></p>
    <form method="POST" action="/employer/apprentices">
      <input name="firstName" placeholder="First name" required />
      <input name="lastName" placeholder="Last name" required />
      <input type="email" name="email" placeholder="Email" required />
      <input name="phone" placeholder="Phone" />
      <button>Add</button>
    </form>

    <h3>Your Apprentices</h3>
    <table border="1" cellpadding="6">
      <tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Level</th></tr>
      ${apprenticeRows || `<tr><td colspan="5">None yet</td></tr>`}
    </table>
  `);
});

app.post("/employer/apprentices", requireRole("employer"), (req, res) => {
  const me = employers.find(e => e.id === req.session.user.refId);
  if (!me) return res.send("Employer record missing.");

  const email = (req.body.email || "").toLowerCase();
  if (findUserByEmail(email)) return res.send("That email already exists (student may already be registered).");

  const studentId = newId("stu");
  const student = {
    id: studentId,
    role: "student",
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email,
    phone: req.body.phone || "",
    address: "",
    employerName: me.companyName,
    level: "",
    status: "Pending enrollment",
    enrollmentDate: "",
    stateLicenseNumber: "",
    rapidsNumber: "",
  };

  students.push(student);
  users.push({ email, role: "student", refId: studentId });
  me.apprentices.push(studentId);

  res.redirect("/employer");
});

// --------------------
// ADMIN DASHBOARD (FIXED DROPDOWNS + STATUS NEXT TO ID)
// --------------------
app.get("/admin", requireAdmin, (req, res) => {
  const filter = (req.query.filter || "").toLowerCase();
  const list = filter === "pending"
    ? students.filter(s => (s.status || "") === "Pending enrollment")
    : students;

  const rows = list.map(s => `
    <tr>
      <td>${esc(s.id)}</td>
      <td>
        <form method="POST" action="/admin/students/${s.id}/status">
          <select name="status" onchange="this.form.submit()">
            ${STATUS_OPTIONS.map(opt =>
              `<option value="${esc(opt)}" ${opt === s.status ? "selected" : ""}>${esc(opt)}</option>`
            ).join("")}
          </select>
        </form>
      </td>
      <td>${esc(s.firstName)}</td>
      <td>${esc(s.lastName)}</td>
      <td>
        <form method="POST" action="/admin/students/${s.id}/level">
          <select name="level" onchange="this.form.submit()">
            ${["", "1", "2", "3", "4"].map(opt =>
              `<option value="${esc(opt)}" ${opt === s.level ? "selected" : ""}>${opt || "-"}</option>`
            ).join("")}
          </select>
        </form>
      </td>
      <td>${esc(s.enrollmentDate)}</td>
      <td>${esc(s.stateLicenseNumber)}</td>
      <td>${esc(s.rapidsNumber)}</td>
      <td>${esc(s.employerName)}</td>
      <td>${esc(s.phone)}</td>
      <td>${esc(s.email)}</td>
      <td>${esc(s.address)}</td>
      <td>
        <form method="POST" action="/admin/students/${s.id}/delete" onsubmit="return confirm('Delete student?')">
          <button>Delete</button>
        </form>
      </td>
      <td>
        <form method="POST" action="/admin/students/${s.id}/approve">
          <button ${s.status !== "Pending enrollment" ? "disabled" : ""}>Approve</button>
        </form>
      </td>
    </tr>
  `).join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Logged in as: ${esc(req.session.user.email)} | <a href="/logout">Logout</a></p>

    <p>
      <a href="/admin">All</a> |
      <a href="/admin?filter=pending">Pending enrollment</a>
    </p>

    <h2>Add Student (Admin)</h2>
    <p><i>Use this only if you want to create accounts manually.</i></p>
    <form method="POST" action="/admin/students">
      <input name="firstName" placeholder="First name" required />
      <input name="lastName" placeholder="Last name" required />
      <input name="email" placeholder="Email" required />
      <input name="phone" placeholder="Phone" />
      <button>Add</button>
    </form>

    <h2>Students</h2>
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
        <th>Approve</th>
      </tr>
      ${rows || `<tr><td colspan="14">No students</td></tr>`}
    </table>
  `);
});

// ADMIN ACTIONS
app.post("/admin/students", requireAdmin, (req, res) => {
  const email = (req.body.email || "").toLowerCase();
  if (findUserByEmail(email)) return res.send("That email already exists.");

  const studentId = newId("stu");
  students.push({
    id: studentId,
    role: "student",
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    email,
    phone: req.body.phone || "",
    address: "",
    employerName: "",
    level: "",
    status: "Pending enrollment",
    enrollmentDate: "",
    stateLicenseNumber: "",
    rapidsNumber: "",
  });

  users.push({ email, role: "student", refId: studentId });
  res.redirect("/admin");
});

app.post("/admin/students/:id/status", requireAdmin, (req, res) => {
  const s = students.find(x => x.id === req.params.id);
  if (s && STATUS_OPTIONS.includes(req.body.status)) s.status = req.body.status;
  res.redirect("/admin");
});

app.post("/admin/students/:id/level", requireAdmin, (req, res) => {
  const s = students.find(x => x.id === req.params.id);
  const v = req.body.level || "";
  if (s && ["", "1", "2", "3", "4"].includes(v)) s.level = v;
  res.redirect("/admin");
});

app.post("/admin/students/:id/approve", requireAdmin, (req, res) => {
  const s = students.find(x => x.id === req.params.id);
  if (!s) return res.redirect("/admin");
  if (s.status !== "Pending enrollment") return res.redirect("/admin");

  s.status = "Currently enrolled in class";
  s.enrollmentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!s.level) s.level = "1";
  res.redirect("/admin?filter=pending");
});

app.post("/admin/students/:id/delete", requireAdmin, (req, res) => {
  const idx = students.findIndex(x => x.id === req.params.id);
  if (idx >= 0) {
    const email = students[idx].email;
    students.splice(idx, 1);

    const uidx = users.findIndex(u => u.email === email);
    if (uidx >= 0) users.splice(uidx, 1);
  }
  res.redirect("/admin");
});

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
