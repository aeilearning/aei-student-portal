const Database = require("better-sqlite3");

// Single persistent DB file
const db = new Database("aei.db");

// ---- TABLES ----
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    firstName TEXT,
    lastName TEXT,
    email TEXT UNIQUE,
    level INTEGER,
    status TEXT,
    yearEnrolled TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ---- INITIALIZE STUDENT ID COUNTER ----
const row = db.prepare("SELECT value FROM meta WHERE key = 'next_student_id'").get();

if (!row) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('next_student_id', ?)"
  ).run("1000");
}

// ---- HELPERS ----
function getNextStudentId() {
  const tx = db.transaction(() => {
    const current = parseInt(
      db.prepare("SELECT value FROM meta WHERE key = 'next_student_id'").get().value,
      10
    );

    const next = current + 1;

    db.prepare(
      "UPDATE meta SET value = ? WHERE key = '
