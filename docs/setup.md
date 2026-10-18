# Setup

How to run SketchSaathi on your own computer.

## 1. Install

```bash
python -m venv venv
venv\Scripts\activate                 # macOS / Linux: source venv/bin/activate
pip install -r requirements-dev.txt   # includes MySQL, IPython and Playwright
```

## 2. Database

SketchSaathi needs **MariaDB 10.11+** or **MySQL 8.4+** locally (Django 6.1 requires it).

```sql
CREATE DATABASE sketchsaathi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Prefer Postgres? Set `DATABASE_URL=postgresql://user:password@host/dbname` and skip MySQL entirely.

```bash
python manage.py migrate
python manage.py createsuperuser      # optional, for /admin/
python manage.py runserver
```

## 3. Settings

Settings come from environment variables or a private `.env` file next to `manage.py`
(it is git-ignored — never commit it). Copy [`.env.example`](../.env.example) to start.

| Variable | Default | Meaning |
|---|---|---|
| `SECRET_KEY` | dev placeholder | Required (long and random) when `DEBUG` is off |
| `DEBUG` | `True` locally, `False` anywhere else | Debug pages show settings, so they stay off in production |
| `ALLOWED_HOSTS` | empty | Comma separated hosts |
| `CSRF_TRUSTED_ORIGINS` | empty | Comma separated `https://…` origins |
| `DATABASE_URL` | – | If set, used instead of the `DB_*` values |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` | `sketchsaathi` / `root` / empty / `127.0.0.1` / `3306` | Local MySQL |
| `LIVE_COLLAB` | `True` (off on Vercel) | Real-time sync between people |

## 4. Live collaboration

`runserver` is served by Daphne, so WebSockets work in development. The channel layer is in memory,
which only works for a single process; with several processes use `channels-redis`.
Edits are broadcast to everyone on the board, and boards autosave shortly after a change.

## 5. Tests

```bash
python manage.py test                                # unit, API, access and realtime tests
```

Browser tests drive Microsoft Edge through Playwright. They are opt-in:

```bash
set RUN_BROWSER_TESTS=1
set SCREENSHOT_DIR=shots                             # optional: keep a screenshot of each step
python manage.py test boards.tests.test_browser
```

## Production checklist

- A long random `SECRET_KEY` and `DEBUG=False` (the app refuses to start otherwise).
- `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` for your domain.
- HTTPS (cookies are secure and HSTS is on when `DEBUG` is off).
- Static files are served by WhiteNoise — no `collectstatic` step.
- Keep your database password out of Git: use the host's environment variables.
- Deploying to Vercel? See [deploy-vercel.md](deploy-vercel.md).
