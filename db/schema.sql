-- USERS: admin, student, employer
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
  level int not null default 1,
  status text not null default 'Currently enrolled in class',
  employer_name text not null default '',
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

-- Optional: track status history
create table if not exists student_status_history (
  id bigserial primary key,
  student_id bigint not null references students(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  changed_by_user_id bigint references users(id),
  changed_at timestamptz not null default now()
);
