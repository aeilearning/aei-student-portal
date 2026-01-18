const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
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

  // ACCESS REQUESTS (register + reset-password)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id BIGSERIAL PRIMARY KEY,
      request_type TEXT NOT NULL CHECK (request_type IN ('register','reset_password')),
      email TEXT NOT NULL,
      requested_role TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // DOCUMENT VAULT (student/employer)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,

      entity_type TEXT NOT NULL CHECK (entity_type IN ('student','employer')),
      entity_id BIGINT NOT NULL,

      category TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',

      original_filename TEXT NOT NULL,
      stored_rel_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      file_size_bytes BIGINT NOT NULL DEFAULT 0,

      uploaded_by_user_id BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);`);

  // OPTIONAL: migrate old student_documents table if it exists (non-destructive)
  // If your old system created student_documents, we copy rows over once.
  try {
    const hasOld = await pool.query(`
      SELECT to_regclass('public.student_documents') AS t;
    `);

    if (hasOld.rows[0].t) {
      const countNew = await pool.query(`SELECT COUNT(*)::int AS c FROM documents;`);
      if (countNew.rows[0].c === 0) {
        // Copy what we can. Old stored_filename is assumed to live directly under uploads/.
        await pool.query(`
          INSERT INTO documents
            (entity_type, entity_id, category, title, original_filename, stored_rel_path, mime_type, file_size_bytes, uploaded_by_user_id, created_at)
          SELECT
            'student'::text,
            student_id,
            COALESCE(doc_type,'Other')::text,
            COALESCE(NULLIF(title,''), original_filename)::text,
            original_filename,
            stored_filename,
            COALESCE(mime_type,'application/octet-stream')::text,
            COALESCE(file_size_bytes,0),
            uploaded_by_user_id,
            created_at
          FROM student_documents
          ON CONFLICT (stored_rel_path) DO NOTHING;
        `);
        console.log("✅ Migrated student_documents -> documents (one-time best effort)");
      }
    }
  } catch (e) {
    // ignore migration issues (safe)
  }

  // Seed admin (first-time only, never overwrites)
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = (process.env.ADMIN_PASSWORD || "").trim();

  if (adminEmail && adminPassword) {
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
      adminEmail,
    ]);
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
