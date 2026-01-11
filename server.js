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
    saveUninitialized: true,
  })
);

// TEMP user store (will be replaced later)
const users = [
  { email: "cam@aeilearning.com", role: "admin" },
];

// ---------- ROUTES ----------

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  res.send(`
    <h2>AEI Learning Portal Login</h2>
    <form method="POST" action="/login">
      <input type="email" name="email" placeholder="Email" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const { email } = req.body;
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.send("User not found. Contact admin.");
  }

  req.session.user = user;
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const { email, role } = req.session.user;

  res.send(`
    <h1>Dashboard</h1>
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
