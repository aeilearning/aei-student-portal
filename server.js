const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 10000;
const isProduction = process.env.NODE_ENV === "production";

/* ===================== INIT DB ===================== */
(async () => {
  await initDb();
})();

/* ===================== APP SETUP ===================== */
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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
      secure: isProduction
    }
  })
);

/* ===================== HELPERS ===================== */
const cleanEmail = (v) => String(v || "").trim().toLowerCase();

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) {
    return res.redirect("/login");
  }
  next();
};

/* ===================== AUTH ===================== */
app.get("/login", (req, res) => {
  res.render("login", { message: req.query.msg || null });
});

app.post("/login", async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    const { rows } = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash)) {
      return res.redirect("/login?msg=Invalid email or password");
    }

    req.session.user = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role
    };

    if (rows[0].role === "admin") return res.redirect("/admin");
    if (rows[0].role === "student") return res.redirect("/student");
    if (rows[0].role === "employer") return res.redirect("/employer");

    res.redirect("/login");
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).send("Server error. Check logs.");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ===================== STUDENT DASHBOARD ===================== */
app.get("/student", requireRole("student"), async (req, res) => {
  let r = await pool.query(
    "SELECT * FROM students WHERE user_id=$1",
    [req.session.user.id]
  );

  if (!r.rows.length) {
    await pool.query(
      "INSERT INTO students (user_id) VALUES ($1)",
      [req.session.user.id]
    );
    r = await pool.query(
      "SELECT * FROM students WHERE user_id=$1",
      [req.session.user.id]
    );
  }

  res.render("student", {
    user: req.session.user,
    student: r.rows[0],
    message: null
  });
});

/* ===================== EMPLOYER DASHBOARD ===================== */
app.get("/employer", requireRole("employer"), async (req, res) => {
  let r = await pool.query(
    "SELECT * FROM employers WHERE user_id=$1",
    [req.session.user.id]
  );

  if (!r.rows.length) {
    await pool.query(
      "INSERT INTO employers (user_id) VALUES ($1)",
      [req.session.user.id]
    );
    r = await pool.query(
      "SELECT * FROM employers WHERE user_id=$1",
      [req.session.user.id]
    );
  }

  res.render("employer", {
    user: req.session.user,
    employer: r.rows[0],
    message: null
  });
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`🚀 AEI Portal running on port ${PORT}`);
});
