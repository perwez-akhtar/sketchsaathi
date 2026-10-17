# Deploy on Vercel

SketchSaathi runs on Vercel with a Neon Postgres database. Live collaboration is off there
(Vercel has no WebSockets); drawing, saving, pages, files, guest mode and login all work.

## 1. Database

In the Vercel dashboard open the project's **Storage** tab, create a **Neon Postgres** database and
connect it to the project. Vercel adds `DATABASE_URL` (or `POSTGRES_URL`) for you.

## 2. Environment variables

Project -> Settings -> Environment Variables:

| Name | Value |
|------|-------|
| `DEBUG` | `False` |
| `SECRET_KEY` | a long random string (`python -c "import secrets; print(secrets.token_urlsafe(50))"`) |

`VERCEL` is set by Vercel itself, which also allows `*.vercel.app` hosts and turns live sync off.
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

- `api/index.py` is the Vercel entry point and `vercel.json` sends every request to it.
- Local development still uses MySQL (`pip install -r requirements-dev.txt`).
- To get live collaboration back, host the app on a service with WebSockets (Railway, Render, Fly.io).
