const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const pgSession = require("connect-pg-simple")(session);

const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

initDb().then(() => console.log("DB ready"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: new pgSession({ pool }),
    secret: "aei-production-secret",
    resave: false,
    saveUninitialized: false,
  })
);

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send("Access denied");
    }
    next();
  };
}

app.get("/", (req, res) => {
  res.send(`
    <h1>AEI Portal</h1>
    <a href="/student/register">Student Signup</a><br/>
    <a href="/employer/register">Employer Signup</a><br/>
    <a href="/login">Login</a>
  `);
});

/* AUTH */
app.get("/login", (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="POST">
      <input name="email" required />
      <input name="password" type="password" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  if (!rows[0]) return res.send("User not found");

  const ok = await bcrypt.compare(password, rows[0].password);
  if (!ok) return res.send("Invalid password");

  req.session.user = rows[0];
  res.redirect(rows[0].role === "admin" ? "/admin" : "/");
});

/* STUDENT SELF REGISTER */
app.get("/student/register", (req, res) => {
  res.send(`
    <h2>Student Registration</h2>
    <form method="POST">
      <input name="email" required />
      <input name="password" type="password" required />
      <input name="first_name" placeholder="First name" />
      <input name="last_name" placeholder="Last name" />
      <button>Create</button>
    </form>
  `);
});

app.post("/student/register", async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  const hash = await bcrypt.hash(password, 10);

  const user = await pool.query(
    "INSERT INTO users (role,email,password) VALUES ('student',$1,$2) RETURNING id",
    [email, hash]
  );

  await pool.query(
    "INSERT INTO students (user_id, first_name, last_name) VALUES ($1,$2,$3)",
    [user.rows[0].id, first_name, last_name]
  );

  res.send("Student account created");
});

/* EMPLOYER SELF REGISTER */
app.get("/employer/register", (req, res) => {
  res.send(`
    <h2>Employer Registration</h2>
    <form method="POST">
      <input name="email" required />
      <input name="password" type="password" required />
      <input name="company_name" placeholder="Company name" />
      <button>Create</button>
    </form>
  `);
});

app.post("/employer/register", async (req, res) => {
  const { email, password, company_name } = req.body;
  const hash = await bcrypt.hash(password, 10);

  const user = await pool.query(
    "INSERT INTO users (role,email,password) VALUES ('employer',$1,$2) RETURNING id",
    [email, hash]
  );

  await pool.query(
    "INSERT INTO employers (user_id, company_name) VALUES ($1,$2)",
    [user.rows[0].id, company_name]
  );

  res.send("Employer account created");
});

/* ADMIN */
app.get("/admin", requireRole("admin"), async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM students");

  const rowsHtml = rows.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${s.status}</td>
      <td>${s.first_name}</td>
      <td>${s.last_name}</td>
      <td>
        <select>
          ${[1,2,3,4].map(l => `<option ${l===s.level?'selected':''}>${l}</option>`)}
        </select>
      </td>
    </tr>
  `).join("");

  res.send(`
    <h1>Admin Dashboard</h1>
    <table border="1">
      <tr>
        <th>ID</th><th>Status</th><th>First</th><th>Last</th><th>Level</th>
      </tr>
      ${rowsHtml}
    </table>
  `);
});

app.listen(PORT, () => console.log("AEI portal running on port " + PORT));

// --------------------
app.listen(PORT, () => {
  console.log("AEI portal running on port " + PORT);
});
