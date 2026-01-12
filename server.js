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
    secret: "TEMP-SESSION-SECRET-CHANGE-LATER",
    resave: false,
    saveUninitialized: false
  })
);

/* --------------------
   USERS (LOGIN ONLY)
-------------------- */
const users = [
  {
    id: 1,
    email: "cam@aeilearning.com",
    passwordHash: bcrypt.hashSync("ChangeMe123!", 10),
    role: "admin"
  }
];

/* --------------------
   STUDENTS (PROFILE DATA)
-------------------- */
const students = [
  {
    id: 1,
    userId: 1,
    firstName: "Cam",
    lastName: "Admin",
    phone: "",
    email: "cam@aeilearning.com",
    address: "",
    needsReview: false
  }
];

/* --------------------
   HELPERS
-------------------- */
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).send("Admins only");
  }
  next();
}

function currentUser(req) {
  return users.find(u => u.id === req.session.userId);
}

/* --------------------
   HOME
-------------------- */
app.get("/", requireLogin, (req, res) => {
  const user = currentUser(req);

  res.send(`
    <h1>AEI Learning Portal</h1>
    <p>Logged in as ${user.email}</p>

    ${user.role === "admin" ? `<a href="/admin">Admin Dashboard</a><br/>` : ""}
    <a href="/profile">My Profile</a><br/>
    <a href="/logout">Logout</a>
  `);
});

/* --------------------
   LOGIN
-------------------- */
app.get("/login", (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="POST">
      <input name="email" placeholder="Email" required /><br/>
      <input name="password" type="password" placeholder="Password" required /><br/>
      <button>Login</button>
    </form>
  `);
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);

  if (!user) return res.send("Invalid email or password");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.send("Invalid email or password");

  req.session.userId = user.id;
  res.redirect("/");
});

/* --------------------
   LOGOUT
-------------------- */
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* --------------------
   STUDENT PROFILE
-------------------- */
app.get("/profile", requireLogin, (req, res) => {
  const student = students.find(s => s.userId === req.session.userId);

  if (!student) return res.send("No student profile found");

  res.send(`
    <h2>My Profile</h2>

    <form method="POST">
      First Name: <input name="firstName" value="${student.firstName}" disabled /><br/>
      Last Name: <input name="lastName" value="${student.lastName}" /><br/>
      Phone: <input name="phone" value="${student.phone}" /><br/>
      Email: <input name="email" value="${student.email}" /><br/>
      Address:<br/>
      <textarea name="address">${student.address}</textarea><br/><br/>

      <button>Save Changes</button>
    </form>

    <br/>
    <a href="/">Back</a>
  `);
});

app.post("/profile", requireLogin, (req, res) => {
  const student = students.find(s => s.userId === req.session.userId);
  if (!student) return res.send("No student profile found");

  student.lastName = req.body.lastName;
  student.phone = req.body.phone;
  student.email = req.body.email;
  student.address = req.body.address;

  student.needsReview = true;

  res.send(`
    <p>Profile updated. Admin has been notified.</p>
    <a href="/">Return Home</a>
  `);
});

/* --------------------
   ADMIN DASHBOARD
-------------------- */
app.get("/admin", requireLogin, requireAdmin, (req, res) => {
  const rows = students.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${s.needsReview ? "🚩" : ""}</td>
      <td>${s.firstName} ${s.lastName}</td>
      <td>${s.email}</td>
      <td>${s.phone}</td>
    </tr>
  `).join("");

  res.send(`
    <h2>Admin Dashboard</h2>

    <table border="1" cellpadding="6">
      <tr>
        <th>ID</th>
        <th>Flag</th>
        <th>Name</th>
        <th>Email</th>
        <th>Phone</th>
      </tr>
      ${rows}
    </table>

    <br/>
    <a href="/">Back</a>
  `);
});

/* --------------------
   START SERVER
-------------------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
