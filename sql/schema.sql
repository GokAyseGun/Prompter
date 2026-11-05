-- Aynalı Prompter — Supabase "Gün Teknik" projesine uygulanan şema (ERP'den bağımsız)
-- Not: Integrations → Data API → Exposed schemas listesine "prompter" eklenmiş olmalı.

create schema if not exists prompter;
revoke all on schema prompter from public, anon;
grant usage on schema prompter to authenticated, service_role;

create table prompter.scripts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Adsız metin', body text not null default '', folder text not null default '',
  target_sec integer check (target_sec is null or target_sec > 0), last_char integer not null default 0,
  opened_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table prompter.script_versions (
  id bigint generated always as identity primary key,
  script_id uuid not null references prompter.scripts(id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, body text not null, created_at timestamptz not null default now()
);
create table prompter.settings (
  owner uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table prompter.takes (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  script_id uuid references prompter.scripts(id) on delete set null, script_title text not null default '',
  started_at timestamptz not null, ended_at timestamptz not null, play_sec real not null default 0,
  progress real not null default 0, completed boolean not null default false, syllables real not null default 0,
  words integer not null default 0, actual_sps real, set_sps real, mode text not null default 'fixed',
  stops integer not null default 0, rewinds integer not null default 0, profile text not null default '', device text not null default ''
);
-- + indeksler, updated_at/otomatik sürüm tetikleyicisi (10 dk'da bir, en çok 60 sürüm, SECURITY DEFINER),
-- sahibine özel RLS politikaları ve realtime.messages üzerinde "prompter:<uid>" kanal politikaları.
-- Kaynak: supabase_migrations (prompter_create_schema, prompter_tables, prompter_versions_trigger_definer, prompter_versions_manual_insert)
