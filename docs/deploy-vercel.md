# Deploy on Vercel

SketchSaathi runs on Vercel with a **Neon Postgres** database. Vercel finds `manage.py`, reads
`ASGI_APPLICATION` from the settings and runs the app itself — no `vercel.json` or extra entry file.
Static files are collected and served from Vercel's CDN.

> Live collaboration is **off by default** on Vercel; see [Live collaboration](#live-collaboration).

## 1. Import the project

Vercel → **Add New → Project** → import your GitHub repo. Keep the detected **Django** preset and the
default root directory. Before pressing **Deploy**, add the variables from step 3.

## 2. Create the database

Vercel → **Storage** → **Neon** (Serverless Postgres) → create it, then **connect it to the project**.

- Leave **Custom Prefix empty**, so the variable is called `DATABASE_URL` (or `POSTGRES_URL`).
  A prefix such as `STORAGE` would hide it from the app.
- Open **Settings → Environment Variables** and check it is there.

## 3. Environment variables

| Name | Value |
|---|---|
| `DEBUG` | `False` |
| `SECRET_KEY` | a long random string: `python -c "import secrets; print(secrets.token_urlsafe(50))"` |

`VERCEL` is set by Vercel itself and allows `*.vercel.app` hosts. For your own domain also add
`ALLOWED_HOSTS=yourdomain.com` and `CSRF_TRUSTED_ORIGINS=https://yourdomain.com`.

## 4. Create the tables (once)

Vercel never runs one-off jobs, so run `migrate` from your own computer against the Neon database.
In Neon: **Connect → Connection pooling off → Show password → Copy snippet**, then in PowerShell:

```powershell
cd "path\to\sketchsaathi"
$env:DATABASE_URL = (Get-Clipboard)                  # the string you just copied
$env:DATABASE_URL.StartsWith("postgresql://")        # must print True
python manage.py migrate                             # about 20 lines ending in OK
Set-Clipboard -Value " "                             # clear the password from the clipboard
exit
```

Never paste that string into chat, files or Git — it contains the database password.
Check Neon → **Tables**: you should see `boards_board`, `boards_page`, `auth_user` and more.

## 5. Deploy and test

Deploy (or **Redeploy**). Open your site's **Production domain** — not an old deployment's own link,
which stays frozen on the code it was built from. Sign up, draw, refresh and check it is still there.

For an admin account run `python manage.py createsuperuser` with `DATABASE_URL` set as in step 4.

## Updating later

| You change | Do this |
|---|---|
| Code | Push to GitHub; Vercel redeploys automatically |
| Environment variables | Redeploy |
| Database structure (new model field) | Push, then run `migrate` again as in step 4 |

## Live collaboration

Vercel supports WebSockets (beta), but each connection is pinned to one function instance and closes at
the function's maximum duration. Sharing drawings between people therefore needs a Redis channel layer
and automatic reconnecting in the client. Until that is added, `LIVE_COLLAB` stays off on Vercel:
everything else (drawing, saving, pages, files, guest mode, login) works.

## Troubleshooting

- **"Not Found" on every page** — you opened an old deployment's link, or extra routing files interfere.
  Use the Production domain and keep the repo free of `vercel.json` rewrites to `/api/index`.
- **500 error on login or sign-up** — the tables are missing or `DATABASE_URL` is not set. Do step 4
  and check the variable name in Vercel.
- **"Did you install mysqlclient?" in the logs** — the app did not find `DATABASE_URL`, so it fell back
  to local MySQL settings.
