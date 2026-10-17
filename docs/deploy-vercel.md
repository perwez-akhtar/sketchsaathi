# Deploy on Vercel

SketchSaathi runs on Vercel with a Neon Postgres database. Vercel detects Django from `manage.py`
and runs it through `config.asgi`, so no `vercel.json` or extra entry file is needed.
Live collaboration is off by default there; see "Live collaboration" below.

## 1. Database

In the Vercel dashboard open the project's **Storage** tab, create a **Neon Postgres** database and
connect it to the project. Vercel adds `DATABASE_URL` (or `POSTGRES_URL`) for you.

## 2. Environment variables

Project -> Settings -> Environment Variables:

| Name | Value |
|------|-------|
| `DEBUG` | `False` |
| `SECRET_KEY` | a long random string (`python -c "import secrets; print(secrets.token_urlsafe(50))"`) |

`VERCEL` is set by Vercel itself, which also allows `*.vercel.app` hosts.
For a custom domain add `ALLOWED_HOSTS=yourdomain.com` and `CSRF_TRUSTED_ORIGINS=https://yourdomain.com`.

## 3. Create the tables (once)

Copy the database URL from Vercel and run this on your computer:

    set DATABASE_URL=postgresql://...        (PowerShell: $env:DATABASE_URL="postgresql://...")
    python manage.py migrate

## 4. Deploy

Push the repo to GitHub, then in Vercel choose **Add New -> Project**, import it and deploy.
Or from the terminal: `npm i -g vercel`, `vercel login`, `vercel --prod`.

## 5. Admin account (optional)

    python manage.py createsuperuser        (with DATABASE_URL set as in step 3)

## Notes

- Local development still uses MySQL (`pip install -r requirements-dev.txt`).
## Live collaboration

Vercel supports WebSockets (beta), but connections are pinned to one function instance, so sharing
drawings between people needs a Redis channel layer, and clients must reconnect when a connection
closes at the function's maximum duration. Until that is added, `LIVE_COLLAB` stays off on Vercel.
