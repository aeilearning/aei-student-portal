// server.js — CLEAN BASELINE + ADMIN SAFE CREATION + AUTH EXTENSIONS

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

/* ===================== CONSTANTS ===================== */
const LEVELS = [1, 2, 3, 4];
const STUDENT_STATUSES = [
  "Pending Enrollment",
  "Active",
  "On Hold",
  "Completed",
  "Withdrawn",
];

/* ===================== DB BOOTSTRAP ===================== */
(async () => {
  try {
    await initDb();
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Database init failed:", err);
    process.exit(1);
  }
})();

/* ===================== VIEW ENGINE ===================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ===================== MIDDLEWARE ===================== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  })
);

/* ===================== HELPERS ===================== */
const cleanEmail = (v) => String(v || "").trim().toLowerCase();

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) {
    return res.redirect("/login");
  }
  next();
};

/* ===================== ROOT ===================== */
app.get("/", (req, res) => res.redirect("/login"));

/* ===================== AUTH ===================== */
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.post(
  "/login",
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    const { rows } = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash)) {
      return res.render("login", { message: "Invalid email or password" });
    }

    req.session.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
    };

    if (rows[0].role === "admin") return res.redirect("/admin");
    if (rows[0].role === "student") return res.redirect("/student");
    if (rows[0].role === "employer") return res.redirect("/employer");

    res.redirect("/login");
  })
);

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ===================== DASHBOARDS ===================== */
app.get(
  "/admin",
  requireRole("admin"),
  wrap(async (req, res) => {
    const students = await pool.query(
      `SELECT s.*, u.email FROM students s JOIN users u ON u.id = s.user_id`
    );

    const employers = await pool.query(
      `SELECT e.*, u.email FROM employers e JOIN users u ON u.id = e.user_id`
    );

    res.render("admin", {
      user: req.session.user,
      students: students.rows,
      employers: employers.rows,
      LEVELS,
      STUDENT_STATUSES,
      message: req.query.msg || null,
    });
  })
);

app.get(
  "/student",
  requireRole("student"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `SELECT s.*, u.email
       FROM students s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [req.session.user.id]
    );

    res.render("student", {
      user: req.session.user,
      student: r.rows[0],
    });
  })
);

app.get(
  "/employer",
  requireRole("employer"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `SELECT e.*, u.email
       FROM employers e JOIN users u ON u.id = e.user_id
       WHERE e.user_id = $1`,
      [req.session.user.id]
    );

    res.render("employer", {
      user: req.session.user,
      employer: r.rows[0],
    });
  })
);

/* ===================== ADMIN CREATE ===================== */
async function createUser({ email, role, tempPassword }) {
  const password =
    tempPassword || Math.random().toString(36).slice(-10);
  const hash = bcrypt.hashSync(password, 10);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1,$2,$3)
     RETURNING id`,
    [email, hash, role]
  );

  return { userId: user.rows[0].id, password };
}

// CREATE STUDENT
app.post(
  "/admin/students/create",
  requireRole("admin"),
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (!email) return res.redirect("/admin?msg=Email required");

    try {
      const { userId, password } = await createUser({
        email,
        role: "student",
        tempPassword: req.body.temp_password,
      });

      await pool.query(
        `INSERT INTO students (user_id) VALUES ($1)`,
        [userId]
      );

      res.redirect(
        "/admin?msg=" +
          encodeURIComponent(`Student created. Temp password: ${password}`)
      );
    } catch (e) {
      if (String(e.message).includes("duplicate key")) {
        return res.redirect("/admin?msg=Email already exists");
      }
      throw e;
    }
  })
);

// CREATE EMPLOYER
app.post(
  "/admin/employers/create",
  requireRole("admin"),
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (!email) return res.redirect("/admin?msg=Email required");

    try {
      const { userId, password } = await createUser({
        email,
        role: "employer",
        tempPassword: req.body.temp_password,
      });

      await pool.query(
        `INSERT INTO employers (user_id) VALUES ($1)`,
        [userId]
      );

      res.redirect(
        "/admin?msg=" +
          encodeURIComponent(`Employer created. Temp password: ${password}`)
      );
    } catch (e) {
      if (String(e.message).includes("duplicate key")) {
        return res.redirect("/admin?msg=Email already exists");
      }
      throw e;
    }
  })
);

/* ===================== REGISTRATION (REQUEST ONLY) ===================== */
app.get("/register", (req, res) => {
  res.render("register", { message: null });
});

app.post(
  "/register",
  wrap(async (req, res) => {
    // For now: request-only (no auto account creation)
    console.log("📩 Registration request:", req.body);
    res.render("register", {
      message:
        "Request received. AEI will contact you if approved.",
    });
  })
);

/* ===================== PASSWORD RESET (MANUAL FOR NOW) ===================== */
app.get("/reset-password", (req, res) => {
  res.render("reset-password", { message: null });
});

app.post(
  "/reset-password",
  wrap(async (req, res) => {
    // Placeholder: admin/manual reset only
    res.render("reset-password", {
      message:
        "Password resets are handled by AEI administration. Please contact support.",
    });
  })
);

/* ===================== ERROR HANDLER ===================== */
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).send("Server error. Check logs.");
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`🚀 AEI portal running on port ${PORT}`);
});

/* ===================== ROUTE LIST ===================== */
app.get("/__routes", (req, res) => {
  res.json(
    app._router.stack
      .filter((r) => r.route)
      .map(
        (r) =>
          Object.keys(r.route.methods)[0].toUpperCase() +
          " " +
          r.route.path
      )
  );
});
