-- The forms, and which version everybody is looking at.
--
-- `offshore_report_templates` records every version and is only ever added to;
-- `offshore_report_templates_live` says which one is live, so "what is everyone seeing"
-- is one read and going back is a change to one row. Version 0 is the company's
-- own form, seeded from the repository and never written again.
--
--   docker exec -i supabase-db psql -U postgres < scripts/templates.sql

create table if not exists offshore_report_templates (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,           -- witness|observation|knowledge|feedback|trip
  version       int  not null,           -- 0 is the company's own, immutable
  path          text,                    -- in the offshore-report-templates bucket; null when only the wording changed
  sha256        text,                    -- what the bytes are, and the cache key everywhere
  size          int,
  anchors       jsonb not null default '{}'::jsonb,   -- slot -> w14:paraId
  blanks        jsonb not null default '{}'::jsonb,   -- {pages, fields, boxes} off the drawing engine
  wording       jsonb not null default '{}'::jsonb,   -- paraId -> new text (and the trip form's strings)
  note          text,                    -- what changed, in the words of whoever changed it
  created_by    uuid,
  created_email text,
  created_at    timestamptz not null default now(),
  unique (kind, version)
);

create table if not exists offshore_report_templates_live (
  kind         text primary key,
  template_id  uuid not null references offshore_report_templates(id),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- The company's blank paperwork is not anybody's private document: everyone
-- signed in reads it, and nobody writes it except the server, which carries
-- the service key and checks for itself that the person asking is an admin.
alter table offshore_report_templates enable row level security;
alter table offshore_report_templates_live enable row level security;

drop policy if exists read_templates on offshore_report_templates;
create policy read_templates on offshore_report_templates for select
  using (auth.role() = 'authenticated');

drop policy if exists read_live on offshore_report_templates_live;
create policy read_live on offshore_report_templates_live for select
  using (auth.role() = 'authenticated');

grant select on offshore_report_templates, offshore_report_templates_live to authenticated;

-- A private bucket of its own, out of reach of the library's admin delete and
-- of the reindexer that walks the library folder.
insert into storage.buckets (id, name, public)
  values ('offshore-report-templates', 'offshore-report-templates', false)
  on conflict (id) do nothing;
