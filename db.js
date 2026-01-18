// db.js — SAFE SCHEMA BOOTSTRAP (NO DESTRUCTIVE MIGRATIONS)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* ================= USERS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','student','employer')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /* ================= STUDENTS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        employer_name TEXT DEFAULT '',
        level INT DEFAULT 1,
        status TEXT DEFAULT 'Pending Enrollment',

        program_name TEXT,
        provider_program_id TEXT,
        program_system_id TEXT,
        student_id_no TEXT,
        student_id_type TEXT,
        enrollment_date DATE,
        exit_date DATE,
        exit_type TEXT,
        credential TEXT,

        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /* ================= EMPLOYERS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employers (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /* ================= ACCESS REQUESTS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        id BIGSERIAL PRIMARY KEY,
        request_type TEXT NOT NULL,
        email TEXT NOT NULL,
        requested_role TEXT,
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /* ================= STUDENT DOCUMENTS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_documents (
        id BIGSERIAL PRIMARY KEY,
        student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
        uploaded_by_user_id BIGINT REFERENCES users(id),
        doc_type TEXT NOT NULL,
        title TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        mime_type TEXT,
        file_size_bytes BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    /* ================= MESSAGE BOARD ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        target_role TEXT NOT NULL CHECK (target_role IN ('student','employer','both','direct')),
        target_user_id BIGINT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_by BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("✅ Database schema verified");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
