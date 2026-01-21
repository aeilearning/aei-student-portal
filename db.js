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
        middle_name TEXT DEFAULT '',
        suffix TEXT DEFAULT '',
        address TEXT DEFAULT '',
        city TEXT DEFAULT '',
        state TEXT DEFAULT '',
        zip_code TEXT DEFAULT '',
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
        ssn TEXT,
        ssn_not_provided BOOLEAN DEFAULT false,
        date_of_birth DATE,
        sex TEXT,
        employment_status TEXT,
        pre_apprenticeship TEXT,
        ethnicity TEXT,
        race TEXT,
        veteran_status TEXT,
        education_level TEXT,
        disability TEXT,
        occupation_name TEXT,
        occupation_code TEXT,
        probationary_period_hours INT,
        term_remaining_hours INT,
        expected_completion_date DATE,
        otjl_credit_hours INT,
        related_instruction_credit_hours INT,
        related_instruction_provider TEXT,
        entry_wage NUMERIC,
        entry_wage_units TEXT,
        wage_schedule TEXT,
        journeyworker_wage NUMERIC,

        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS middle_name TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS suffix TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS zip_code TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS ssn TEXT,
      ADD COLUMN IF NOT EXISTS ssn_not_provided BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS date_of_birth DATE,
      ADD COLUMN IF NOT EXISTS sex TEXT,
      ADD COLUMN IF NOT EXISTS employment_status TEXT,
      ADD COLUMN IF NOT EXISTS pre_apprenticeship TEXT,
      ADD COLUMN IF NOT EXISTS ethnicity TEXT,
      ADD COLUMN IF NOT EXISTS race TEXT,
      ADD COLUMN IF NOT EXISTS veteran_status TEXT,
      ADD COLUMN IF NOT EXISTS education_level TEXT,
      ADD COLUMN IF NOT EXISTS disability TEXT,
      ADD COLUMN IF NOT EXISTS occupation_name TEXT,
      ADD COLUMN IF NOT EXISTS occupation_code TEXT,
      ADD COLUMN IF NOT EXISTS probationary_period_hours INT,
      ADD COLUMN IF NOT EXISTS term_remaining_hours INT,
      ADD COLUMN IF NOT EXISTS expected_completion_date DATE,
      ADD COLUMN IF NOT EXISTS otjl_credit_hours INT,
      ADD COLUMN IF NOT EXISTS related_instruction_credit_hours INT,
      ADD COLUMN IF NOT EXISTS related_instruction_provider TEXT,
      ADD COLUMN IF NOT EXISTS entry_wage NUMERIC,
      ADD COLUMN IF NOT EXISTS entry_wage_units TEXT,
      ADD COLUMN IF NOT EXISTS wage_schedule TEXT,
      ADD COLUMN IF NOT EXISTS journeyworker_wage NUMERIC;
    `);

    /* ================= EMPLOYERS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employers (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        city TEXT DEFAULT '',
        state TEXT DEFAULT '',
        zip_code TEXT DEFAULT '',
        ein TEXT DEFAULT '',
        naics_code TEXT DEFAULT '',
        start_date DATE,
        inmate_program TEXT,
        contact_first_name TEXT DEFAULT '',
        contact_last_name TEXT DEFAULT '',
        contact_address TEXT DEFAULT '',
        contact_city TEXT DEFAULT '',
        contact_state TEXT DEFAULT '',
        contact_zip TEXT DEFAULT '',
        contact_email TEXT DEFAULT '',
        contact_phone TEXT DEFAULT '',
        contact_extension TEXT DEFAULT '',
        contact_same_as_employer BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE employers
      ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS zip_code TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS ein TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS naics_code TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS start_date DATE,
      ADD COLUMN IF NOT EXISTS inmate_program TEXT,
      ADD COLUMN IF NOT EXISTS contact_first_name TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_last_name TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_address TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_city TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_state TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_zip TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_phone TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_extension TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_same_as_employer BOOLEAN DEFAULT false;
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

    /* ================= EMPLOYER DOCUMENTS ================= */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employer_documents (
        id BIGSERIAL PRIMARY KEY,
        employer_id BIGINT REFERENCES employers(id) ON DELETE CASCADE,
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
