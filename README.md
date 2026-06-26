# Content Approval Calendar

A lightweight, **no-build** web app for scheduling social posts and getting client
sign-off, one month at a time. Built for the SocialFlare Creative content workflow
and backed by [Supabase](https://supabase.com). Because it's plain HTML/CSS/JS, it
deploys as-is on GitHub Pages.

There are two sides:

- **Admin** (you) — sign in, manage clients, and add / edit / delete posts. Switch
  between the **Calendar** and an **Approved & Scheduled** posting queue.
- **Client review** — a shareable per-client link. Clients see only their own posts
  (images and playable videos) and can **Approve** or **Request Changes** with notes.
  On phones it's a scrollable, big-tap-target list grouped by date; on tablet/desktop
  it's the calendar grid. They can't add, edit, or delete anything.

**Platforms** (each color-coded): LinkedIn, TikTok, Pinterest, Instagram, Facebook,
and Google Business Profile (GBP). Images and videos work the same across all six.

**Status flow:** **Pending** (gray) → **Approved** (green) → **Posted** (blue), plus
**Changes Requested** (orange). Clients can only set *Approved* or *Changes Requested*;
only the admin can mark a post **Posted**.

Each post also carries a **publish date & time** (when it should go live), separate
from when it was created — shown on the calendar, the post detail, and the queue.

### The Approved & Scheduled queue

The admin **Approved & Scheduled** tab is your daily posting worksheet: every approved
post that hasn't been posted yet, sorted by publish date/time. Each item shows the
platform tag, publish time, the media, and the full caption — with one-click **Copy
caption** and **Download media** buttons, plus **Mark as Posted** (which moves it out
of the queue). You use it to post natively into each platform.

---

## 1. One-time Supabase setup

### a. Create the tables and security rules

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open [`supabase-setup.sql`](./supabase-setup.sql) from this repo, copy the whole
   file into the editor, and click **Run**.

That creates the `clients` and `posts` tables, turns on Row Level Security, and adds
two token-scoped functions (`get_client_review`, `submit_review`) that power the
client review link. It also creates the public **`post-media`** Storage bucket and its
policies (public read; insert/update/delete only for signed-in admins), and inserts one
"Sample Client" so you have something to test with (safe to delete later).

### b. Create your admin login

The admin side requires a signed-in Supabase user. Create yourself one:

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email + a password, and tick **Auto Confirm User** so you can sign in
   right away.
3. (Recommended) Supabase → **Authentication** → **Providers** → **Email** → turn
   **off** "Allow new users to sign up", so only users you create can ever sign in.

That's it — no keys to paste. The project URL and the public **anon** key are already
wired into `app.js` (the anon key is safe to ship in the browser; all real protection
comes from the Row Level Security policies in the SQL file).

---

## 2. Using the admin side

Open the app (locally or your GitHub Pages URL) with **no query string**:

```
https://YOUR-USER.github.io/content-approval-calendar/
```

1. **Sign in** with the email/password you created above.
2. Pick a **Client** from the dropdown, or click **+ New client** to add one.
3. Click **+ Add post** (or click any day cell) to schedule a post. Choose the
   date, platform (LinkedIn, TikTok, Pinterest, Instagram, Facebook, or GBP), post
   type, status, **publish date & time**, and caption. For **media**, drag & drop
   (or browse to) an image (JPG, PNG, WEBP, GIF) or video (MP4, MOV, WEBM) — it
   uploads to the `post-media` bucket with a live progress bar and shows a thumbnail
   / video preview. Media is optional, and you can still paste a URL as a fallback.
   It saves to Supabase immediately.
4. Click an existing post to **edit** or **delete** it.
5. Switch to the **Approved & Scheduled** tab to work your posting queue (copy
   caption, download media, mark posted).
6. The summary bar at the top reflects the selected client's real numbers.

---

## 3. Generating and testing a client review link

1. On the admin side, select the client in the dropdown.
2. Click **Copy review link** — the link is copied to your clipboard. It looks like:

   ```
   https://YOUR-USER.github.io/content-approval-calendar/?client=<token>
   ```

   The `<token>` is a long random value unique to that client (stored as
   `review_token` in the `clients` table). Anyone with the link can review that
   client's posts — and only that client's — without logging in.

3. **Test it:** paste the link into a new private/incognito window. You should see
   the client's name in the header and only their posts, with no admin toolbar.
   Click a post, add a note if you like, and hit **Approve** or **Request Changes**.
   Switch back to the admin view and reload — the new status and notes are there.

To **revoke** a link, change that client's `review_token` in the Supabase Table
Editor (or delete the client). The old link stops working immediately.

---

## 4. Running locally

No server is required, but a tiny static server avoids browser file-URL quirks:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

---

## Files

| File                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `index.html`         | Markup: calendar, admin toolbar, modals              |
| `styles.css`         | Styling, color tokens, responsive layout             |
| `app.js`             | Calendar rendering + Supabase admin/client logic     |
| `supabase-setup.sql` | One-time SQL: tables, RLS policies, review functions  |

## How the security model works

- **Admin** is any authenticated Supabase user. RLS policies grant signed-in users
  full read/write on `clients` and `posts`.
- **Clients are anonymous** and get **no** direct table access. The review link calls
  two `SECURITY DEFINER` functions that take the link token, verify it, and only ever
  return or modify that one client's data — and `submit_review` can change *only* the
  `status` and `reviewer_notes` columns. So a client link can't read other clients,
  can't edit captions/dates, and can't delete anything, even though the anon key is
  public.
