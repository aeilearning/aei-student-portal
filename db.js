// db.js
const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- Base tables (create if missing) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS students (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        level INT NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'Pending Enrollment',
        employer_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS employers (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        company_name TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS student_status_history (
        id BIGSERIAL PRIMARY KEY,
        student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        old_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        changed_by_user_id BIGINT REFERENCES users(id),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // --- Columns that must exist (handles legacy DBs) ---
    await client.query(`
      ALTER TABLE students  ADD COLUMN IF NOT EXISTS user_id BIGINT;
      ALTER TABLE employers ADD COLUMN IF NOT EXISTS user_id BIGINT;

      ALTER TABLE users     ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE students  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE employers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `);

    // --- Role constraint (safe) ---
    // If old DB had role values outside the set, this constraint could fail.
    // So we enforce with a "NOT VALID" check, then validate later if you want.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin','student','employer')) NOT VALID;
        END IF;
      END $$;
    `);

    // --- Unique user_id per student/employer (safe) ---
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'students_user_id_unique'
        ) THEN
          ALTER TABLE students
            ADD CONSTRAINT students_user_id_unique UNIQUE (user_id) DEFERRABLE INITIALLY IMMEDIATE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'employers_user_id_unique'
        ) THEN
          ALTER TABLE employers
            ADD CONSTRAINT employers_user_id_unique UNIQUE (user_id) DEFERRABLE INITIALLY IMMEDIATE;
        END IF;
      END $$;
    `);

    // --- Foreign keys to users (use NOT VALID so legacy rows don't crash boot) ---
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'students_user_id_fkey'
        ) THEN
          ALTER TABLE students
            ADD CONSTRAINT students_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'employers_user_id_fkey'
        ) THEN
          ALTER TABLE employers
            ADD CONSTRAINT employers_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
        END IF;
      END $$;
    `);

    // If you KNOW your DB is clean, you can validate constraints later:
    // await client.query("ALTER TABLE users VALIDATE CONSTRAINT users_role_check;");
    // await client.query("ALTER TABLE students VALIDATE CONSTRAINT students_user_id_fkey;");
    // await client.query("ALTER TABLE employers VALIDATE CONSTRAINT employers_user_id_fkey;");

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
