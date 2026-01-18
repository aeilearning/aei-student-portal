-- db/schema.sql
-- NOTE: db.js:initDb() is the authoritative schema.
-- This file mirrors initDb() so humans can read it and so you can bootstrap manually if needed.

-- USERS
create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','student','employer')),
  created_at timestamptz not null default now()
);

-- STUDENTS (Identity + RAPIDS fields + outcomes)
create table if not exists students (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete cascade,

  -- Identity
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  employer_name text not null default '',

  -- Program/progress
  level int not null default 1 check (level between 1 and 4),
  status text not null default 'Pending Enrollment'
    check (status in ('Pending Enrollment','Active','On Hold','Completed','Withdrawn')),

  -- RAPIDS enrollment fields
  program_name text not null default '',
  provider_program_id text not null default '',
  program_system_id text not null default '',
  student_id_no text not null default '',
  student_id_type text not null default '',

  enrollment_date date,
  exit_date date,
  exit_type text not null default '',
  credential text not null default '',

  created_at timestamptz not null default now()
);

-- EMPLOYERS
create table if not exists employers (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete cascade,
  company_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

-- STATUS HISTORY
create table if not exists student_status_history (
  id bigserial primary key,
  student_id bigint not null references students(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  changed_by_user_id bigint references users(id),
  changed_at timestamptz not null default now()
);

-- DOCUMENT VAULT (Admin uploads for students in this revision)
create table if not exists student_documents (
  id bigserial primary key,
  student_id bigint not null references students(id) on delete cascade,
  uploaded_by_user_id bigint references users(id),

  doc_type text not null,
  title text not null default '',

  original_filename text not null,
  stored_filename text not null,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null default 0,

  created_at timestamptz not null default now()
);

-- INTAKE REQUESTS (used by /register and /reset-password)
create table if not exists access_requests (
  id bigserial primary key,
  request_type text not null check (request_type in ('register','reset_password')),
  email text not null,
  requested_role text not null default '' check (requested_role in ('','student','employer')),
  note text not null default '',
  status text not null default 'new' check (status in ('new','in_progress','done','rejected')),
  created_at timestamptz not null default now()
);

-- INDEXES (important for performance)
create index if not exists idx_students_user_id on students(user_id);
create index if not exists idx_employers_user_id on employers(user_id);
create index if not exists idx_status_history_student_id on student_status_history(student_id);
create index if not exists idx_student_documents_student_id on student_documents(student_id);
create index if not exists idx_access_requests_email on access_requests(email);
create index if not exists idx_access_requests_status on access_requests(status);
