const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  /* ======================================================
     CORE TABLES (CREATE IF MISSING)
     ====================================================== */

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
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      level INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Pending Enrollment',
      employer_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employers (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ======================================================
     MIGRATIONS — SAFE COLUMN ADDS
     ====================================================== */

  /* ---- students.user_id ---- */
  await pool.query(`
    ALTER TABLE students
    ADD COLUMN IF NOT EXISTS user_id BIGINT;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE constraint_name = 'students_user_id_unique'
      ) THEN
        ALTER TABLE students
        ADD CONSTRAINT students_user_id_unique UNIQUE (user_id);
      END IF;
    END
    $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE constraint_name = 'students_user_id_fkey'
      ) THEN
        ALTER TABLE students
        ADD CONSTRAINT students_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE;
      END IF;
    END
    $$;
  `);

  /* ---- employers.user_id ---- */
  await pool.query(`
    ALTER TABLE employers
    ADD COLUMN IF NOT EXISTS user_id BIGINT;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE constraint_name = 'employers_user_id_unique'
      ) THEN
        ALTER TABLE employers
        ADD CONSTRAINT employers_user_id_unique UNIQUE (user_id);
      END IF;
    END
    $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE constraint_name = 'employers_user_id_fkey'
      ) THEN
        ALTER TABLE employers
        ADD CONSTRAINT employers_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE;
      END IF;
    END
    $$;
  `);

  /* ======================================================
     HISTORY TABLE
     ====================================================== */

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
}

module.exports = {
  pool,
  initDb,
};
