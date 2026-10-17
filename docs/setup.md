# Setup

## Database

SketchSaathi uses MySQL/MariaDB. Django 6.1 needs MariaDB 10.11+ or MySQL 8.4+.

    CREATE DATABASE sketchsaathi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

Connection settings are read from environment variables, with local defaults:

| Variable      | Default     |
|---------------|-------------|
| `DB_NAME`     | `sketchsaathi`  |
| `DB_USER`     | `root`      |
| `DB_PASSWORD` | (empty)     |
| `DB_HOST`     | `127.0.0.1` |
| `DB_PORT`     | `3306`      |

Other settings (`config/settings.py`): `SECRET_KEY`, `DEBUG` (default `True`), `ALLOWED_HOSTS` (comma separated).
See `.env.example`.

## Real-time collaboration

`runserver` is served by Daphne (installed app `daphne`), so WebSockets work in development.
The channel layer is in-memory, which only works with a single process. For production use
`channels-redis` and point `CHANNEL_LAYERS` at Redis.

Edits are broadcast to everyone on the board; boards autosave shortly after a change, and the last save wins.

## Dev tools

`requirements-dev.txt` adds IPython and django-extensions (`shell_plus`, `show_urls`).

## Production checklist

- Set `SECRET_KEY`, `DEBUG=False` and `ALLOWED_HOSTS`; this also turns on secure cookies.
- Static files are served by WhiteNoise, so no `collectstatic` step is needed.
- Run the app with an ASGI server (`daphne config.asgi:application`) behind HTTPS so `wss://` works.
- Use `channels-redis` for `CHANNEL_LAYERS` if you run more than one process.
- Use MariaDB 10.11+ / MySQL 8.4+.

## Tests

    python manage.py test                       # unit, API and realtime tests

Browser tests drive the installed Microsoft Edge through Playwright (in `requirements-dev.txt`).
They are opt-in:

    set RUN_BROWSER_TESTS=1
    set SCREENSHOT_DIR=shots                    # optional: keep a screenshot of each step
    python manage.py test boards.tests.test_browser
