<div align="center">

# SketchSaathi

**A fast, friendly whiteboard for sketching ideas together.**

Draw shapes, write notes, drop in images and plan on multiple pages — then share a link.

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Django](https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-0d9488.svg)](LICENSE)

[**Live demo**](https://sketchsaathi-studio.vercel.app) · [Setup](docs/setup.md) · [Deploy on Vercel](docs/deploy-vercel.md)

</div>

---

## Features

| | |
|---|---|
| **Drawing** | Pen, line, arrow, rectangle, diamond, ellipse, text, eraser — hold <kbd>Shift</kbd> for straight lines, squares and circles |
| **Editing** | Select, move, resize, multi-select, copy / paste, duplicate, layers, flip, lock, full undo / redo |
| **Styles** | Stroke and fill colours, width, dashed / dotted, rounded edges, opacity, three fonts |
| **Pages** | Boards hold several pages, like tabs in a notebook, each with its own background |
| **More tools** | Images (paste or drop), frames, laser pointer, bucket fill, lasso selection |
| **Sharing** | Share a link; collaborators see each other's cursors in real time (where WebSockets are available) |
| **Files** | Save a board to a `.saathi` file and open it again, or export a page as PNG |
| **Guest mode** | Draw without an account — sign up later and your sketches move into it |
| **Comfort** | Dark mode, mobile layout with pinch-to-zoom, keyboard shortcuts for everything (press <kbd>?</kbd>) |

## Tech stack

- **Backend:** Django 6.1, Django REST Framework, Django Channels
- **Frontend:** plain JavaScript and canvas, Bootstrap 5 for the site pages
- **Database:** MySQL / MariaDB locally, Postgres (Neon) in production
- **Hosting:** Vercel

## Quick start

```bash
git clone https://github.com/perwez-akhtar/sketchsaathi.git
cd sketchsaathi
python -m venv venv
venv\Scripts\activate            # macOS / Linux: source venv/bin/activate
pip install -r requirements-dev.txt
```

Create a MySQL database called `sketchsaathi` (or set `DATABASE_URL` to any Postgres URL), then:

```bash
python manage.py migrate
python manage.py runserver
```

Open <http://127.0.0.1:8000>. Settings are read from environment variables or a private `.env` file —
see [`.env.example`](.env.example) and [docs/setup.md](docs/setup.md).

## Tests

```bash
python manage.py test                                   # unit, API, security and realtime tests
set RUN_BROWSER_TESTS=1 && python manage.py test boards.tests.test_browser   # browser tests (Edge + Playwright)
```

## Project structure

```
config/          settings, URLs, ASGI / WSGI
boards/
  models.py      Board and Page
  views.py       pages: landing, editor, login, sign-up
  api/           REST API for boards and pages
  realtime/      WebSocket consumer for live collaboration
  templates/     site and editor templates
  static/        CSS and JavaScript (canvas, app, collab, ...)
  tests/
docs/            setup and deployment guides
```

## Security

Board links use random ids, only owners can rename or delete boards and pages, drawing data is validated,
logins are rate-limited and production runs with debug off, HTTPS and secure cookies.
Found a problem? Please open an issue.

## License

[MIT](LICENSE) © 2026 Md Perwez Akhtar
