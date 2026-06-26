-- ============================================================
--  Content Approval Calendar — Supabase schema & security
--  Run this whole file once in: Supabase → SQL Editor → New query → Run
--
--  Written idempotently: every statement is safe to re-run, so you can
--  paste the whole file again at any time to apply schema upgrades.
-- ============================================================

-- ----------------------------------------------------------------
--  Tables
-- ----------------------------------------------------------------

-- Clients (one row per brand/account you create review links for)
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- random, hard-to-guess token used in the shareable review link
  review_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at   timestamptz not null default now()
);

-- Posts (scheduled content shown on the calendar)
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  date           date not null,
  publish_at     timestamptz,               -- when the post should go live (separate from created_at)
  platform       text not null,             -- constraint added/maintained below
  post_type      text not null,
  caption        text not null default '',
  image_url      text,                      -- legacy; kept populated for images
  media_url      text,                      -- public URL of the uploaded image OR video
  media_type     text check (media_type in ('image','video')),
  status         text not null default 'pending',  -- constraint added/maintained below
  reviewer_notes text not null default '',
  created_at     timestamptz not null default now()
);

-- If the posts table already existed, add the newer columns in place.
alter table public.posts add column if not exists publish_at timestamptz;
alter table public.posts add column if not exists media_url  text;
alter table public.posts add column if not exists media_type text;

-- media_type check (image | video)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_media_type_check'
  ) then
    alter table public.posts
      add constraint posts_media_type_check
      check (media_type is null or media_type in ('image','video'));
  end if;
end $$;

-- platform check — the six supported platforms. Drop & re-add so re-running
-- this file widens an older two-platform constraint in place.
alter table public.posts drop constraint if exists posts_platform_check;
alter table public.posts
  add constraint posts_platform_check
  check (platform in ('linkedin','tiktok','pinterest','instagram','facebook','gbp'));

-- status check — Pending → Approved → Posted, plus Changes Requested.
-- Drop & re-add so re-running widens an older constraint that lacked 'posted'.
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts
  add constraint posts_status_check
  check (status in ('pending','approved','changes_requested','posted'));

create index if not exists posts_client_id_idx  on public.posts (client_id);
create index if not exists posts_date_idx        on public.posts (date);
create index if not exists posts_publish_at_idx  on public.posts (publish_at);

-- ----------------------------------------------------------------
--  Row Level Security
--
--  Model:
--   * ADMIN  = a signed-in Supabase Auth user (you). Full read/write
--              on everything via the policies below.
--   * CLIENT = anonymous visitor holding a review link. Gets NO direct
--              table access; instead they call the two SECURITY DEFINER
--              functions below, which validate the link token and only
--              ever expose / mutate that one client's data.
-- ----------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.posts   enable row level security;

-- Admin (any authenticated user) — full access to clients
drop policy if exists "admin full access on clients" on public.clients;
create policy "admin full access on clients"
  on public.clients for all
  to authenticated
  using (true) with check (true);

-- Admin (any authenticated user) — full access to posts
drop policy if exists "admin full access on posts" on public.posts;
create policy "admin full access on posts"
  on public.posts for all
  to authenticated
  using (true) with check (true);

-- NOTE: no policies are granted to the anon role, so anonymous visitors
-- cannot read or write the tables directly. They go through the RPCs below.

-- ----------------------------------------------------------------
--  Client-review RPCs (token-scoped, no login required)
-- ----------------------------------------------------------------

-- Return a client's name + their posts, for a valid review token.
create or replace function public.get_client_review(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_posts  json;
begin
  select * into v_client from public.clients where review_token = p_token;
  if not found then
    return null;                       -- unknown / revoked token
  end if;

  select coalesce(json_agg(row_to_json(p) order by p.date, p.created_at), '[]'::json)
    into v_posts
  from (
    select id, client_id, date, publish_at, platform, post_type, caption,
           image_url, media_url, media_type,
           status, reviewer_notes, created_at
    from public.posts
    where client_id = v_client.id
  ) p;

  return json_build_object(
    'client', json_build_object('id', v_client.id, 'name', v_client.name),
    'posts',  v_posts
  );
end;
$$;

-- Let a client set ONLY status + reviewer_notes on one of THEIR posts.
-- Clients can ONLY move a post to 'approved' or 'changes_requested' (or back
-- to 'pending'); marking a post 'posted' is reserved for the signed-in admin.
create or replace function public.submit_review(
  p_token   text,
  p_post_id uuid,
  p_status  text,
  p_notes   text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_row       public.posts%rowtype;
begin
  if p_status not in ('pending','approved','changes_requested') then
    raise exception 'invalid status: %', p_status;
  end if;

  select id into v_client_id from public.clients where review_token = p_token;
  if v_client_id is null then
    raise exception 'invalid review token';
  end if;

  update public.posts
     set status         = p_status,
         reviewer_notes = coalesce(p_notes, '')
   where id = p_post_id
     and client_id = v_client_id      -- can only touch their own posts
  returning * into v_row;

  if not found then
    raise exception 'post not found for this client';
  end if;

  return row_to_json(v_row);
end;
$$;

-- Allow anonymous (and signed-in) visitors to call the review RPCs.
grant execute on function public.get_client_review(text)              to anon, authenticated;
grant execute on function public.submit_review(text, uuid, text, text) to anon, authenticated;

-- ----------------------------------------------------------------
--  Storage: the "post-media" bucket (images & videos)
--
--  Reads are PUBLIC (anyone with the URL can view). Writes (insert),
--  updates, and deletes require a signed-in Supabase Auth user — i.e.
--  the admin. Anonymous review-link visitors can view media but never
--  upload or delete.
-- ----------------------------------------------------------------

-- Create the public bucket (id == name). Re-running just keeps it public.
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do update set public = true;

-- Public read of objects in this bucket.
drop policy if exists "post-media public read" on storage.objects;
create policy "post-media public read"
  on storage.objects for select
  to public
  using (bucket_id = 'post-media');

-- Authenticated admin can upload (insert) into this bucket.
drop policy if exists "post-media authenticated insert" on storage.objects;
create policy "post-media authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'post-media');

-- Authenticated admin can overwrite (update) objects in this bucket.
drop policy if exists "post-media authenticated update" on storage.objects;
create policy "post-media authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'post-media')
  with check (bucket_id = 'post-media');

-- Authenticated admin can delete objects in this bucket.
drop policy if exists "post-media authenticated delete" on storage.objects;
create policy "post-media authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'post-media');

-- ----------------------------------------------------------------
--  Optional: a sample client to get you started (safe to delete).
--  After running, grab its token from:  Table editor → clients
-- ----------------------------------------------------------------
insert into public.clients (name)
select 'Sample Client'
where not exists (select 1 from public.clients);
