const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || "/var/data/aei.db";

// Ensure directory exists (Render disk)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      level INTEGER,
      status TEXT,
      original_enrollment_date TEXT,
      state_license_number TEXT,
      rapids_number TEXT,
      employer TEXT,
      phone TEXT,
      email TEXT,
      home_address TEXT
    )
  `);
});

module.exports = db;
