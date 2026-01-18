// db.js
const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // USERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','student','employer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // STUDENTS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      employer_name TEXT NOT NULL DEFAULT '',

      level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
      status TEXT NOT NULL DEFAULT 'Pending Enrollment'
        CHECK (status IN ('Pending Enrollment','Active','On Hold','Completed','Withdrawn')),

      program_name TEXT NOT NULL DEFAULT '',
      provider_program_id TEXT NOT NULL DEFAULT '',
      program_system_id TEXT NOT NULL DEFAULT '',
      student_id_no TEXT NOT NULL DEFAULT '',
      student_id_type TEXT NOT NULL DEFAULT '',

      enrollment_date DATE,
      exit_date DATE,
      exit_type TEXT NOT NULL DEFAULT '',
      credential TEXT NOT NULL DEFAULT '',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // EMPLOYERS
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

  // STATUS HISTORY
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

  // DOCUMENT VAULT (Admin uploads for students in this revision)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_documents (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      uploaded_by_user_id BIGINT REFERENCES users(id),

      doc_type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',

      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      file_size_bytes BIGINT NOT NULL DEFAULT 0,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // INTAKE REQUESTS (used by /register and /reset-password)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id BIGSERIAL PRIMARY KEY,
      request_type TEXT NOT NULL CHECK (request_type IN ('register','reset_password')),
      email TEXT NOT NULL,
      requested_role TEXT NOT NULL DEFAULT '' CHECK (requested_role IN ('','student','employer')),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','done','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Indexes (Postgres does NOT auto-index FKs)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_employers_user_id ON employers(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_status_history_student_id ON student_status_history(student_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_student_documents_student_id ON student_documents(student_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);`);

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
