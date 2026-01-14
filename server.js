const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const { pool, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- BOOTSTRAP DATABASE ---------- */
(async () => {
  try {
    await initDb();
    console.log("Database initialized");
  } catch (err) {
    console.error("Database init failed", err);
    process.exit(1);
  }
})();

/* ---------- VIEW ENGINE ---------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ---------- MIDDLEWARE ---------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // IMPORTANT: must be false until HTTPS is enforced
    },
  })
);

/* ---------- AUTH HELPERS ---------- */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  next();
}

/* ---------- ROUTES ---------- */
app.get("/", (req, res) => {
  res.redirect("/login");
});

/* ---------- LOGIN ---------- */
app.get("/login", (req, res) => {
  res.render("login", { message: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email.toLowerCase()]
  );

  if (!result.rows.length) {
    return res.render("login", { message: "Invalid email or password" });
  }

  const user = result.rows[0];

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.render("login", { message: "Invalid email or password" });
  }

  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  if (user.role === "admin") return res.redirect("/admin");
  if (user.role === "student") return res.redirect("/student");
  if (user.role === "employer") return res.redirect("/employer");

  return res.redirect("/login");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

/* ---------- ADMIN (TEMP STUB) ---------- */
app.get("/admin", requireAdmin, (req, res) => {
  res.send(
    "Admin logged in successfully. Admin dashboard wiring comes next."
  );
});

/* ---------- STUDENT (TEMP STUB) ---------- */
app.get("/student", requireLogin, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.redirect("/login");
  }
  res.send("Student logged in successfully.");
});

/* ---------- EMPLOYER (TEMP STUB) ---------- */
app.get("/employer", requireLogin, (req, res) => {
  if (req.session.user.role !== "employer") {
    return res.redirect("/login");
  }
  res.send("Employer logged in successfully.");
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`AEI portal running on port ${PORT}`);
});
