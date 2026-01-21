-- AEI Student Portal schema (reference)
-- NOTE: Runtime schema is applied by db.js initDb()

create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','student','employer')),
  created_at timestamptz not null default now()
);

create table if not exists students (
  id bigserial primary key,
  user_id bigint unique references users(id) on delete cascade,

  first_name text default '',
  last_name text default '',
  phone text default '',
  employer_name text default '',
  level int default 1,
  status text default 'Pending Enrollment',

  -- RAPIDS fields
  program_name text,
  provider_program_id text,
  program_system_id text,
  student_id_no text,
  student_id_type text,
  enrollment_date date,
  exit_date date,
  exit_type text,
  credential text,

  created_at timestamptz not null default now()
);

create table if not exists employers (
  id bigserial primary key,
  user_id bigint unique references users(id) on delete cascade,
  company_name text default '',
  contact_name text default '',
  phone text default '',
  created_at timestamptz not null default now()
);

create table if not exists access_requests (
  id bigserial primary key,
  request_type text not null,
  email text not null,
  requested_role text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists student_documents (
  id bigserial primary key,
  student_id bigint references students(id) on delete cascade,
  uploaded_by_user_id bigint references users(id),
  doc_type text not null,
  title text not null,
  original_filename text not null,
  stored_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists employer_documents (
  id bigserial primary key,
  employer_id bigint references employers(id) on delete cascade,
  uploaded_by_user_id bigint references users(id),
  doc_type text not null,
  title text not null,
  original_filename text not null,
  stored_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id bigserial primary key,
  target_role text not null check (target_role in ('student','employer','both','direct')),
  target_user_id bigint,
  title text not null,
  body text not null,
  created_by bigint references users(id),
  created_at timestamptz not null default now()
);
