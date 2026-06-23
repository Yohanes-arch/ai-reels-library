create extension if not exists pgcrypto;

create table if not exists public.reel_items (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  source_type text not null default 'instagram-export',
  source_account text,
  source_path text,
  saved_at timestamptz,
  sent_at timestamptz,
  collection_name text,
  raw_text text not null default '',
  title text not null default '',
  category text not null default 'Uncategorized',
  summary text not null default '',
  tutorial text not null default '',
  priority_score integer not null default 0 check (priority_score >= 0 and priority_score <= 100),
  status text not null default 'unprocessed',
  tags text[] not null default '{}',
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(url, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(tutorial, '') || ' ' ||
      coalesce(raw_text, '') || ' ' ||
      coalesce(collection_name, '') || ' ' ||
      array_to_string(tags, ' ')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.reel_items(id) on delete cascade,
  url text not null,
  host text not null default '',
  link_type text not null default 'tool',
  label text,
  created_at timestamptz not null default now(),
  unique (item_id, url)
);

create index if not exists idx_reel_items_category on public.reel_items(category);
create index if not exists idx_reel_items_status on public.reel_items(status);
create index if not exists idx_reel_items_priority on public.reel_items(priority_score desc);
create index if not exists idx_reel_items_search on public.reel_items using gin(search_vector);
create index if not exists idx_item_links_item_id on public.item_links(item_id);
create index if not exists idx_item_links_type on public.item_links(link_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_reel_items_updated_at on public.reel_items;
create trigger set_reel_items_updated_at
before update on public.reel_items
for each row execute function public.set_updated_at();

alter table public.reel_items enable row level security;
alter table public.item_links enable row level security;

drop policy if exists "MVP anon read reel items" on public.reel_items;
drop policy if exists "MVP anon write reel items" on public.reel_items;
drop policy if exists "MVP anon read item links" on public.item_links;
drop policy if exists "MVP anon write item links" on public.item_links;

create policy "MVP anon read reel items"
on public.reel_items for select
to anon
using (true);

create policy "MVP anon write reel items"
on public.reel_items for all
to anon
using (true)
with check (true);

create policy "MVP anon read item links"
on public.item_links for select
to anon
using (true);

create policy "MVP anon write item links"
on public.item_links for all
to anon
using (true)
with check (true);

create or replace view public.reel_mcp_leads as
select *
from public.reel_items
where
  category = 'MCP'
  or priority_score >= 60
  or search_vector @@ plainto_tsquery('simple', 'mcp tradingview github scanner indicator');

