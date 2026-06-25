# Content Approval Calendar

A lightweight, dependency-free web app for reviewing and approving scheduled social
content one month at a time. Built for the SocialFlare Creative content workflow.

## Features

- **Monthly calendar grid** — 7 columns, Sunday → Saturday, with previous/next navigation and a "Today" jump.
- **Posts per day** — each day cell holds one or more scheduled posts.
- **Post details** — platform tag (Facebook = blue, Instagram = pink), post type, a thumbnail placeholder, and the caption.
- **Approval workflow** — every post has a status: **Pending** (gray), **Approved** (green), or **Changes Requested** (orange).
- **Review actions** — click any post to open it, then **Approve** or **Request Changes** with an optional reviewer notes box.
- **Summary bar** — live totals for posts, approved, pending, and changes requested.
- **Clean & mobile-friendly** — responsive layout that works on phones and desktops.
- **Persistent** — approval decisions and notes are saved in the browser via `localStorage`.

## Usage

No build step or server required — it's plain HTML, CSS, and JavaScript.

1. Open `index.html` in any modern browser, **or**
2. Serve the folder locally:
   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```

The app ships with ~8 sample posts across June 2026 so you can see the workflow immediately.

### Resetting sample data

State is stored under the `cac.posts.v1` key in `localStorage`. To restore the
original sample posts, clear your browser's site data (or run
`localStorage.removeItem('cac.posts.v1')` in the console) and reload.

## Files

| File         | Purpose                                  |
| ------------ | ---------------------------------------- |
| `index.html` | Markup and modal structure               |
| `styles.css` | Styling, color tokens, responsive layout |
| `app.js`     | Calendar rendering, state, and approval logic |
