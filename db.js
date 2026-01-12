const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      first_name TEXT,
      last_name TEXT,
      level INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Currently enrolled in class',
      enrollment_date DATE,
      phone TEXT,
      address TEXT
    );

    CREATE TABLE IF NOT EXISTS employers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      company_name TEXT,
      contact_name TEXT,
      phone TEXT,
      address TEXT
    );
  `);
}

module.exports = { pool, initDb };
