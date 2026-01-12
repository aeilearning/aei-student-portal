const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

/* --------------------
   BASIC APP SETUP
-------------------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: "CHANGE-THIS-TO-A-REAL-SECRET-LATER",
    resave: false,
    saveUninitialized: false
  })
);

/* --------------------
   USERS (TEMP / IN-MEMORY)
-------------------- */
const users = [
  {
    id: 1,
    role: "admin",
    email: "cam@aeilearning.com",
    passwordHash: bcrypt.hashSync("ChangeMe123!", 10),
    firstName: "Cam",
    lastName: "Admin"
  },
  {
    id: 2,
    role: "student",
    email: "student@test.com",
    passwordHash: bcrypt.hashSync("Student123!", 10),
    firstName: "Test",
    lastName: "Student",
    phone: "",
    address: "",
    profileChanged: false
  }
];

/* --------------------
   AUTH HELPERS
-------------------- */
function getCurrentUser(req) {
  return users.find(u => u.id === req.session.userId);
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || user.role !== "admin") {
    return res.status(403).send("Admins only");
  }
  next();
}

/* --------------------
   ROOT ROUTE
-------------------- */
app.get("/", requireLogin, (req, res) => {
  const user = getCurrentUser(req);

  if (user.role === "admin") {
    return res.redirect("/admin");
  }

  res.redirect("/student");
});

/* --------------------
   LOGIN / LOGOUT
-------------------- */
app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Portal Login</h2>
    <form method="POST">
      <input name="email" placeholder="Email" required /><br/><br/>
      <input name="password" type="password" placeholder="Password" required /><br/><br/>
      <button>Login</button>
    </form>
  `);
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.send("Invalid email or password");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.send("Invalid email or password");
  }

  req.session.userId = user.id;
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* --------------------
   ADMIN DASHBOARD
-------------------- */
app.get("/admin", requireLogin, requireAdmin, (req, res) => {
  const studentRows = users
    .filter(u => u.role === "student")
    .map(s => `
      <tr>
        <td>${s.firstName} ${s.lastName}</td>
        <td>${s.email}</td>
        <td>${s.profileChanged ? "⚠️ UPDATED" : "OK"}</td>
        <td>
          ${s.profileChanged ? `
            <form method="POST" action="/admin/clear-flag/${s.id}">
              <button>Clear Flag</button>
            </form>
          ` : ""}
        </td>
      </tr>
    `)
    .join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Logged in as Admin</p>

    <table border="1" cellpadding="8">
      <tr>
        <th>Student</th>
        <th>Email</th>
        <th>Status</th>
        <th>Action</th>
      </tr>
      ${studentRows || "<tr><td colspan='4'>No students</td></tr>"}
    </table>

    <br/>
    <a href="/logout">Logout</a>
  `);
});

app.post("/admin/clear-flag/:id", requireLogin, requireAdmin, (req, res) => {
  const student = users.find(u => u.id == req.params.id && u.role === "student");
  if (student) {
    student.profileChanged = false;
  }
  res.redirect("/admin");
});

/* --------------------
   STUDENT DASHBOARD
-------------------- */
app.get("/student", requireLogin, (req, res) => {
  const user = getCurrentUser(req);

  if (user.role !== "student") {
    return res.status(403).send("Students only");
  }

  res.send(`
    <h1>Student Portal</h1>
    <p>Welcome ${user.firstName} ${user.lastName}</p>

    <a href="/student/profile">Edit My Profile</a><br/><br/>
    <a href="/logout">Logout</a>
  `);
});

/* --------------------
   STUDENT PROFILE
-------------------- */
app.get("/student/profile", requireLogin, (req, res) => {
  const user = getCurrentUser(req);

  if (user.role !== "student") {
    return res.status(403).send("Students only");
  }

  res.send(`
    <h2>My Profile</h2>

    <form method="POST">
      First Name:<br/>
      <input name="firstName" value="${user.firstName}" /><br/><br/>

      Last Name:<br/>
      <input name="lastName" value="${user.lastName}" /><br/><br/>

      Phone:<br/>
      <input name="phone" value="${user.phone || ""}" /><br/><br/>

      Email:<br/>
      <input name="email" value="${user.email}" /><br/><br/>

      Address:<br/>
      <textarea name="address">${user.address || ""}</textarea><br/><br/>

      <button>Save Changes</button>
    </form>

    <br/>
    <a href="/student">Back</a>
  `);
});

app.post("/student/profile", requireLogin, (req, res) => {
  const user = getCurrentUser(req);

  if (user.role !== "student") {
    return res.status(403).send("Students only");
  }

  user.firstName = req.body.firstName;
  user.lastName = req.body.lastName;
  user.phone = req.body.phone;
  user.email = req.body.email;
  user.address = req.body.address;
  user.profileChanged = true;

  res.redirect("/student");
});

/* --------------------
   START SERVER
-------------------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
