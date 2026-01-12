const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   DATABASE
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

/* =========================
   BASIC APP SETUP
========================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "DEV-SECRET",
    resave: false,
    saveUninitialized: false
  })
);

/* =========================
   AUTH HELPERS
========================= */
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

async function requireAdmin(req, res, next) {
  const result = await pool.query(
    "SELECT role FROM users WHERE id = $1",
    [req.session.userId]
  );

  if (!result.rows.length || result.rows[0].role !== "admin") {
    return res.status(403).send("Admins only");
  }

  next();
}

/* =========================
   BASIC PAGE LAYOUT
========================= */
function layout(title, body, role) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>${title}</title>
    <style>
      body { font-family: Arial; margin: 0; background:#f4f4f4; }
      header { background:#003366; color:white; padding:15px; }
      nav a { color:white; margin-right:15px; text-decoration:none; }
      main { padding:20px; }
      .card { background:white; padding:20px; border-radius:5px; }
      table { width:100%; border-collapse:collapse; }
      th, td { border:1px solid #ccc; padding:8px; }
      th { background:#eee; }
    </style>
  </head>
  <body>
    <header>
      <strong>AEI Learning Portal</strong><br/>
      <nav>
        <a href="/">Home</a>
        ${role === "admin" ? `<a href="/admin">Admin</a>` : ""}
        <a href="/logout">Logout</a>
      </nav>
    </header>
    <main>
      ${body}
    </main>
  </body>
  </html>
  `;
}

/* =========================
   HOME (ROUTES BY ROLE)
========================= */
app.get("/", requireLogin, async (req, res) => {
  const result = await pool.query(
    "SELECT role, email FROM users WHERE id = $1",
    [req.session.userId]
  );

  const user = result.rows[0];

  if (user.role === "admin") {
    return res.redirect("/admin");
  }

  res.send(
    layout(
      "Student Dashboard",
      `
      <div class="card">
        <h2>Student Dashboard</h2>
        <p>Logged in as ${user.email}</p>
        <p>Your training progress and profile tools will appear here.</p>
      </div>
      `,
      "student"
    )
  );
});

/* =========================
   LOGIN
========================= */
app.get("/login", (req, res) => {
  res.send(
    layout(
      "Login",
      `
      <div class="card">
        <h2>Login</h2>
        <form method="POST">
          <input name="email" placeholder="Email" required /><br/><br/>
          <input name="password" type="password" placeholder="Password" required /><br/><br/>
          <button>Login</button>
        </form>
      </div>
      `
    )
  );
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );

  if (!result.rows.length) {
    return res.send("Invalid email or password");
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    return res.send("Invalid email or password");
  }

  req.session.userId = user.id;
  res.redirect("/");
});

/* =========================
   LOGOUT
========================= */
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* =========================
   ADMIN DASHBOARD
========================= */
app.get("/admin", requireLogin, requireAdmin, async (req, res) => {
  const students = await pool.query(
    "SELECT id, first_name, last_name, email, role FROM users ORDER BY last_name"
  );

  const rows = students.rows
    .map(
      s => `
      <tr>
        <td>${s.first_name || ""} ${s.last_name || ""}</td>
        <td>${s.email}</td>
        <td>${s.role}</td>
      </tr>
    `
    )
    .join("");

  res.send(
    layout(
      "Admin Dashboard",
      `
      <div class="card">
        <h2>Admin Dashboard</h2>
        <table>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
          ${rows}
        </table>
      </div>
      `,
      "admin"
    )
  );
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log("AEI Portal running on port " + PORT);
});
