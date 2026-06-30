# Shared calendar setup (Supabase) — ~5 minutes

By default the calendar saves to **one browser only**. Follow these steps once to turn it
into a **live shared calendar** that all 3 of you can use from any computer, with changes
syncing automatically. It's free and needs no credit card.

---

## 1. Create a free Supabase project

1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub.
2. Click **New project**.
   - Name: anything (e.g. `content-calendar`)
   - Database password: set one (you won't need it again for this)
   - Region: pick the one closest to your team
3. Wait ~1 minute for it to finish setting up.

## 2. Create the tables

1. In the left sidebar, open **SQL Editor** → **New query**.
2. Paste the block below and click **Run**.

```sql
-- Tables for the shared calendar
create table if not exists campaigns (
  id    text primary key,
  name  text,
  color text
);

create table if not exists posts (
  id              text primary key,
  title           text,
  date            text,
  campaign_id     text,
  status          text,
  repeat_type     text,
  repeat_end_date text,
  parent_id       text
);

-- Turn on row-level security, then allow shared (no-login) access
alter table campaigns enable row level security;
alter table posts      enable row level security;

create policy "shared access" on campaigns for all using (true) with check (true);
create policy "shared access" on posts      for all using (true) with check (true);

-- Broadcast changes live to everyone
alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table campaigns;
```

## 3. Copy your two keys

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy these two values:
   - **Project URL** (looks like `https://abcdwxyz.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## 4. Paste them into `config.js`

Open **`config.js`** in this repo and replace the placeholders:

```js
window.SUPABASE_URL      = 'https://abcdwxyz.supabase.co';   // your Project URL
window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';                  // your anon public key
```

Commit and push to GitHub.

## 5. Done

Reload the page (hard-refresh: **Cmd/Ctrl + Shift + R**). The pill in the top bar should
change from **"Local only"** to **"Shared · live"**.

- The **first** person to load after setup seeds the shared calendar with their current
  posts. Everyone else's view is then replaced by the shared one — so if anyone has posts
  worth keeping, have them **Export** first (Backup button) and you can Import later.
- After that, every create / move / duplicate / delete shows up for all 3 of you within a
  second or two. Incognito and other computers all see the same calendar.

---

### Notes & limits
- The **anon key is safe to commit** — it's a public client key. Access is controlled by the
  database rules above. Anyone who has your site URL *and* key can edit the calendar, which is
  what you want for a shared team tool. If you later want per-person logins, that's a Supabase
  Auth add-on we can wire up.
- The **activity log** (Backup button) stays per-browser — it records what *you* did.
- **Export/Import** still works as a manual backup at any time.
- If Supabase is ever unreachable, the app falls back to this browser's local copy and keeps
  working; it re-syncs on the next change once reconnected.
