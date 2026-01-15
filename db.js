// db.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','student','employer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

      -- basic profile
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      employer_name TEXT NOT NULL DEFAULT '',

      -- your program tracking (simple + compliance-friendly)
      level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
      status TEXT NOT NULL DEFAULT 'Pending Enrollment'
        CHECK (status IN ('Pending Enrollment','Active','On Hold','Completed','Withdrawn')),

      -- ETPL / reporting fields (matching your templates)
      general_program_name TEXT NOT NULL DEFAULT '',
      provider_general_program_id TEXT NOT NULL DEFAULT '',
      program_system_id TEXT NOT NULL DEFAULT '',
      student_id_no TEXT NOT NULL DEFAULT '',
      student_id_no_type TEXT NOT NULL DEFAULT 'Other',

      -- exit reporting fields (matching Exiter template)
      exit_date DATE,
      exit_type TEXT NOT NULL DEFAULT '',
      credential_awarded BOOLEAN NOT NULL DEFAULT false,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employers (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_status_history (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      old_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      changed_by_user_id BIGINT REFERENCES users(id),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // DOCUMENT VAULT (audit-friendly)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,

      -- ownership / linking
      owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
      employer_id BIGINT REFERENCES employers(id) ON DELETE CASCADE,

      -- audit trail
      uploaded_by_user_id BIGINT REFERENCES users(id),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- metadata
      doc_type TEXT NOT NULL DEFAULT 'Other',
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',

      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes BIGINT NOT NULL DEFAULT 0
    );
  `);

  // Seed admin (first-time only, never overwrites)
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = (process.env.ADMIN_PASSWORD || "").trim();

  if (adminEmail && adminPassword) {
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [adminEmail]);
    if (existing.rows.length === 0) {
      const bcrypt = require("bcryptjs");
      const hash = bcrypt.hashSync(adminPassword, 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`,
        [adminEmail, hash]
      );
      console.log("✅ Admin user created (first time only)");
    }
  }

  console.log("✅ Database ready (NO resets, NO deletes)");
}

module.exports = { pool, initDb };
