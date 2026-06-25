-- ============================================================
--  Content Approval Calendar — Supabase schema & security
--  Run this whole file once in: Supabase → SQL Editor → New query → Run
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
  platform       text not null check (platform in ('facebook','instagram')),
  post_type      text not null,
  caption        text not null default '',
  image_url      text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','changes_requested')),
  reviewer_notes text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists posts_client_id_idx on public.posts (client_id);
create index if not exists posts_date_idx      on public.posts (date);

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
    select id, client_id, date, platform, post_type, caption, image_url,
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
--  Optional: a sample client to get you started (safe to delete).
--  After running, grab its token from:  Table editor → clients
-- ----------------------------------------------------------------
insert into public.clients (name)
select 'Sample Client'
where not exists (select 1 from public.clients);
