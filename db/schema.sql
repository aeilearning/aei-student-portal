-- AEI Student Portal schema (source-of-truth reference)
-- Note: app startup also runs initDb() in db.js to ensure tables exist.

create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','student','employer')),
  created_at timestamptz not null default now()
);

create table if not exists students (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete cascade,

  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  employer_name text not null default '',

  level int not null default 1 check (level between 1 and 4),
  status text not null default 'Pending Enrollment'
    check (status in ('Pending Enrollment','Active','On Hold','Completed','Withdrawn')),

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

create table if not exists employers (
  id bigserial primary key,
  user_id bigint not null unique references users(id) on delete cascade,
  company_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists student_status_history (
  id bigserial primary key,
  student_id bigint not null references students(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  changed_by_user_id bigint references users(id),
  changed_at timestamptz not null default now()
);

-- Requests coming from /register and /reset-password
create table if not exists access_requests (
  id bigserial primary key,
  request_type text not null check (request_type in ('register','reset_password')),
  email text not null,
  requested_role text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Unified document vault (student/employer)
create table if not exists documents (
  id bigserial primary key,

  entity_type text not null check (entity_type in ('student','employer')),
  entity_id bigint not null,

  category text not null,
  title text not null default '',

  original_filename text not null,
  stored_rel_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null default 0,

  uploaded_by_user_id bigint references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_entity on documents(entity_type, entity_id);
create index if not exists idx_access_requests_email on access_requests(email);
