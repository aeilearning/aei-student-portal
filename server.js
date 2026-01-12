const express = require("express");
const session = require("express-session");
const pg = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

/* ------------------ BASIC SETUP ------------------ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

/* ------------------ DATABASE ------------------ */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ------------------ ADMIN CREDS ------------------ */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

/* ------------------ BOOTSTRAP ------------------ */
async function ensureAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn("⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set. Skipping admin bootstrap.");
    return;
  }

  const client = await pool.connect();
  try {
    // Base table (safe on first boot)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL
      );
    `);

    // Ensure password_hash column exists (schema-safe)
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
    `);

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [ADMIN_EMAIL]
    );

    if (existing.rowCount === 0) {
      await client.query(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
        [ADMIN_EMAIL, ADMIN_PASSWORD]
      );
      console.log("✅ Admin user created:", ADMIN_EMAIL);
    } else {
      console.log("ℹ️ Admin already exists:", ADMIN_EMAIL);
    }
  } catch (err) {
    console.error("❌ Admin bootstrap failed:", err.message);
  } finally {
    client.release();
  }
}

// Never allow bootstrap failure to crash the app
ensureAdmin().catch(() => {});

/* ------------------ AUTH HELPERS ------------------ */
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

/* ------------------ ROUTES ------------------ */
app.get("/", requireLogin, (req, res) => {
  res.send(`
    <h1>Student Roster Dashboard</h1>
    <p>Logged in as ${req.session.user.email}</p>
    <a href="/logout">Logout</a>
  `);
});

app.get("/login", (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="POST">
      <input name="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password.trim();

  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );

  if (
    result.rowCount === 0 ||
    result.rows[0].password_hash !== password
  ) {
    return res.send("Invalid email or password");
  }

  const user = result.rows[0];

  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ------------------ START ------------------ */
app.listen(PORT, () => {
  console.log("AEI Portal running on port", PORT);
});

