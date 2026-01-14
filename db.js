const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // ⚠️ HARD RESET — SAFE BECAUSE THIS IS PRE-PRODUCTION
  await pool.query(`DROP TABLE IF EXISTS student_status_history CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS students CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS employers CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS users CASCADE`);

  /* ================= USERS ================= */
  await pool.query(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','student','employer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ================= STUDENTS ================= */
  await pool.query(`
    CREATE TABLE students (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      employer_name TEXT NOT NULL DEFAULT '',
      level INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Pending Enrollment',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ================= EMPLOYERS ================= */
  await pool.query(`
    CREATE TABLE employers (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ================= STATUS HISTORY ================= */
  await pool.query(`
    CREATE TABLE student_status_history (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL
        REFERENCES students(id) ON DELETE CASCADE,
      old_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      changed_by_user_id BIGINT
        REFERENCES users(id),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log("✅ Database schema reset and initialized cleanly");
}

module.exports = { pool, initDb };
