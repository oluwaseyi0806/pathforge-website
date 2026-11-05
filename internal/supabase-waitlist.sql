-- PathForge sign-ups table for Supabase (waitlist + free test pack).
-- Paste ALL of this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again: it only adds what is missing.

create table if not exists public.waitlist (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 120),
  email       text not null check (char_length(email) between 3 and 200 and email like '%@%'),
  country     text check (char_length(country) <= 80),
  plan        text check (plan in ('Personal', 'Business', 'Academic', 'Not sure yet')),
  machine     text check (char_length(machine) <= 120)
);

-- where the sign-up came from: the waitlist form or the free test pack
alter table public.waitlist add column if not exists source text not null default 'waitlist';

-- the same email can only sign up once per form
drop index if exists waitlist_email_unique;
create unique index if not exists waitlist_email_source_unique on public.waitlist (lower(email), source);

-- Row Level Security ON with NO public policies:
-- the website can't read or write this table directly. Only our server
-- function (api/signup.js, using the secret service key) can add rows.
alter table public.waitlist enable row level security;
drop policy if exists "Visitors can join the waitlist" on public.waitlist;
