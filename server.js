require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const pg = require("pg");
const pgSession = require("connect-pg-simple")(session);

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------
// CONFIG
// --------------------
const STATUS_OPTIONS = [
  "Currently enrolled in class",
  "Paused",
  "Dropped class",
  "Dropped program",
];

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL not set. App will not function without Postgres.");
}
if (!process.env.SESSION_SECRET) {
  console.warn("⚠️  SESSION_SECRET not set. Set it in Render Environment variables.");
}

// Postgres pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

// --------------------
// APP MIDDLEWARE
// --------------------
app.set("view engine", "ejs");
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
    },
  })
);

// Attach user to locals
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// --------------------
// HELPERS
// --------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (!roles.includes(req.session.user.role)) return res.status(403).send("Forbidden");
    next();
  };
}

function cleanEmail(s = "") {
  return String(s).trim().toLowerCase();
}

function toInt(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

// --------------------
// DB: bootstrap schema + seed admin
// --------------------
async function ensureSchemaAndSeed() {
  // Create core tables if missing (lightweight bootstrapping)
  // If you prefer, run db/schema.sql manually via Render shell/psql.
  await pool.query(`
    create table if not exists users (
      id bigserial primary key,
      email text not null unique,
      password_hash text not null,
      role text not null check (role in ('admin','student','employer')),
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists students (
      id bigserial primary key,
      user_id bigint not null unique references users(id) on delete cascade,
      first_name text not null default '',
      last_name text not null default '',
      phone text not null default '',
      level int not null default 1,
      status text not null default 'Currently enrolled in class',
      employer_name text not null default '',
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists employers (
      id bigserial primary key,
      user_id bigint not null unique references users(id) on delete cascade,
      company_name text not null default '',
      contact_name text not null default '',
      phone text not null default '',
      created_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists student_status_history (
      id bigserial primary key,
      student_id bigint not null references students(id) on delete cascade,
      old_status text not null,
      new_status text not null,
      changed_by_user_id bigint references users(id),
      changed_at timestamptz not null default now()
    );
  `);

  // Seed admin (idempotent)
  const adminEmail = cleanEmail(process.env.ADMIN_EMAIL || "cam@aeilearning.com");
  const adminPass = process.env.ADMIN_PASSWORD || "ChangeMeNow!";

  const existing = await pool.query("select id from users where email=$1", [adminEmail]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(adminPass, 12);
    await pool.query(
      "insert into users (email, password_hash, role) values ($1,$2,'admin')",
      [adminEmail, hash]
    );
    console.log(`✅ Seeded admin: ${adminEmail} (set ADMIN_PASSWORD env var ASAP)`);
  } else {
    console.log(`✅ Admin exists: ${adminEmail}`);
  }
}

// --------------------
// ROUTES: public
// --------------------
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "admin") return res.redirect("/admin");
  if (req.session.user.role === "student") return res.redirect("/student");
  if (req.session.user.role === "employer") return res.redirect("/employer");
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    const r = await pool.query("select id, email, password_hash, role from users where email=$1", [
      email,
    ]);
    if (r.rowCount === 0) return res.render("login", { error: "Invalid email or password." });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render("login", { error: "Invalid email or password." });

    req.session.user = { id: user.id, email: user.email, role: user.role };
    res.redirect("/");
  } catch (e) {
    console.error(e);
    res.render("login", { error: "Login failed. Try again." });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --------------------
// ADMIN
// --------------------
app.get("/admin", requireRole("admin"), async (req, res) => {
  const students = await pool.query(`
    select s.id, s.first_name, s.last_name, u.email, s.level, s.status, s.employer_name
    from students s
    join users u on u.id = s.user_id
    order by s.last_name, s.first_name;
  `);

  const employers = await pool.query(`
    select e.id, e.company_name, e.contact_name, u.email, e.phone
    from employers e
    join users u on u.id = e.user_id
    order by e.company_name;
  `);

  res.render("admin", {
    statusOptions: STATUS_OPTIONS,
    students: students.rows,
    employers: employers.rows,
    message: req.query.msg || null,
  });
});

// Create Student (creates user + student)
app.post("/admin/students", requireRole("admin"), async (req, res) => {
  const email = cleanEmail(req.body.email);
  const tempPassword = String(req.body.tempPassword || "Welcome123!");
  const firstName = String(req.body.firstName || "");
  const lastName = String(req.body.lastName || "");
  const phone = String(req.body.phone || "");
  const level = toInt(req.body.level, 1);
  const status = STATUS_OPTIONS.includes(req.body.status) ? req.body.status : STATUS_OPTIONS[0];
  const employerName = String(req.body.employerName || "");

  try {
    const hash = await bcrypt.hash(tempPassword, 12);

    const created = await pool.query(
      "insert into users (email, password_hash, role) values ($1,$2,'student') returning id",
      [email, hash]
    );

    await pool.query(
      `insert into students (user_id, first_name, last_name, phone, level, status, employer_name)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [created.rows[0].id, firstName, lastName, phone, level, status, employerName]
    );

    res.redirect("/admin?msg=" + encodeURIComponent("Student created."));
  } catch (e) {
    console.error(e);
    res.redirect("/admin?msg=" + encodeURIComponent("Failed to create student (email may already exist)."));
  }
});

// Update student status + history
app.post("/admin/students/:studentId/status", requireRole("admin"), async (req, res) => {
  const studentId = toInt(req.params.studentId, null);
  const newStatus = req.body.status;

  if (!studentId || !STATUS_OPTIONS.includes(newStatus)) {
    return res.redirect("/admin?msg=" + encodeURIComponent("Invalid status update."));
  }

  try {
    const cur = await pool.query("select status from students where id=$1", [studentId]);
    if (cur.rowCount === 0) return res.redirect("/admin?msg=" + encodeURIComponent("Student not found."));

    const oldStatus = cur.rows[0].status;

    await pool.query("update students set status=$1 where id=$2", [newStatus, studentId]);

    await pool.query(
      `insert into student_status_history (student_id, old_status, new_status, changed_by_user_id)
       values ($1,$2,$3,$4)`,
      [studentId, oldStatus, newStatus, req.session.user.id]
    );

    res.redirect("/admin?msg=" + encodeURIComponent("Status updated."));
  } catch (e) {
    console.error(e);
    res.redirect("/admin?msg=" + encodeURIComponent("Status update failed."));
  }
});

// Create Employer (creates user + employer)
app.post("/admin/employers", requireRole("admin"), async (req, res) => {
  const email = cleanEmail(req.body.email);
  const tempPassword = String(req.body.tempPassword || "Welcome123!");
  const companyName = String(req.body.companyName || "");
  const contactName = String(req.body.contactName || "");
  const phone = String(req.body.phone || "");

  try {
    const hash = await bcrypt.hash(tempPassword, 12);

    const created = await pool.query(
      "insert into users (email, password_hash, role) values ($1,$2,'employer') returning id",
      [email, hash]
    );

    await pool.query(
      `insert into employers (user_id, company_name, contact_name, phone)
       values ($1,$2,$3,$4)`,
      [created.rows[0].id, companyName, contactName, phone]
    );

    res.redirect("/admin?msg=" + encodeURIComponent("Employer created."));
  } catch (e) {
    console.error(e);
    res.redirect("/admin?msg=" + encodeURIComponent("Failed to create employer (email may already exist)."));
  }
});

// --------------------
// STUDENT
// --------------------
app.get("/student", requireRole("student"), async (req, res) => {
  const r = await pool.query(
    `select s.*, u.email
     from students s join users u on u.id=s.user_id
     where s.user_id=$1`,
    [req.session.user.id]
  );
  if (r.rowCount === 0) return res.send("Student profile not found. Contact admin.");

  res.render("student", { student: r.rows[0] });
});

// --------------------
// EMPLOYER
// --------------------
app.get("/employer", requireRole("employer"), async (req, res) => {
  const r = await pool.query(
    `select e.*, u.email
     from employers e join users u on u.id=e.user_id
     where e.user_id=$1`,
    [req.session.user.id]
  );
  if (r.rowCount === 0) return res.send("Employer profile not found. Contact admin.");

  // For now, just a dashboard stub.
  res.render("employer", { employer: r.rows[0] });
});

// --------------------
// START
// --------------------
ensureSchemaAndSeed()
  .then(() => {
    app.listen(PORT, () => {
      console.log("AEI portal running on port " + PORT);
    });
  })
  .catch((e) => {
    console.error("❌ Failed to start (schema/seed error):", e);
    process.exit(1);
  });
