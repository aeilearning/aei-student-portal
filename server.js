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
   TEMP IN-MEMORY USERS
   (DATABASE COMES LATER)
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
   AUTH HELPERS
-------------------- */
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).send("Admins only");
  }
  next();
}

/* --------------------
   ROUTES
-------------------- */
app.get("/", requireLogin, (req, res) => {
  res.send(`
    <h1>AEI Learning Portal</h1>
    <p>You are logged in.</p>
    <a href="/admin">Admin</a><br/>
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

/* --------------------
   LOGOUT
-------------------- */
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* --------------------
   ADMIN (PLACEHOLDER)
-------------------- */
app.get("/admin", requireLogin, requireAdmin, (req, res) => {
  res.send("<h2>Admin dashboard (students coming next)</h2>");
});

/* --------------------
   START SERVER
-------------------- */
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
