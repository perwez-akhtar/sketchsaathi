<div align="center">

<a href="https://sketchsaathi.vercel.app" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/editor-dark.png">
    <img alt="SketchSaathi editor with a small flow drawn on the canvas" src="docs/images/editor.png" width="860">
  </picture>
</a>

<h4>
  <a href="https://sketchsaathi.vercel.app">SketchSaathi Editor</a> |
  <a href="docs/setup.md">Setup</a> |
  <a href="docs/deploy-vercel.md">Deploy on Vercel</a> |
  <a href="https://github.com/perwez-akhtar/sketchsaathi/issues">Issues</a>
</h4>

<h2>
  A fast, friendly whiteboard for sketching ideas together.<br>
  Draw, write, plan on many pages, then share a link.
</h2>

<p>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0d9488.svg"></a>
  <a href="https://sketchsaathi.vercel.app"><img alt="Live" src="https://img.shields.io/badge/live-sketchsaathi.vercel.app-0d9488"></a>
  <a href="https://github.com/perwez-akhtar/sketchsaathi/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat"></a>
  <a href="https://www.python.org/"><img alt="Python" src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white"></a>
  <a href="https://www.djangoproject.com/"><img alt="Django" src="https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white"></a>
</p>

<p><em>Create hand-drawn style diagrams, wireframes, or whatever you like, on your own or together.</em></p>

</div>

---

## Features

- 🎨&nbsp;Hand-drawn style canvas with pen, line, arrow, rectangle, diamond, ellipse, text and eraser.
- ✏️&nbsp;Select, move, resize, multi-select, copy / paste, layers, flip, lock, and full undo / redo.
- 🖌️&nbsp;Stroke and fill colours, width, dashed / dotted, rounded edges, opacity, three fonts.
- 📄&nbsp;Boards with several pages, like tabs in a notebook, each with its own background.
- 🖼️&nbsp;Images (paste or drop), frames, laser pointer, bucket fill, lasso selection.
- 🔗&nbsp;Share a link; collaborators see each other's cursors in real time (where WebSockets are available).
- 💾&nbsp;Autosave to your account, plus save and open `.saathi` files or export a page as PNG.
- 👤&nbsp;Guest mode: draw without an account, then sign up and your sketches move into it.
- 🌓&nbsp;Dark mode, mobile layout with pinch-to-zoom, and keyboard shortcuts for everything (press <kbd>?</kbd>).

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

## Contributing

- Found a bug or missing something? [Open an issue](https://github.com/perwez-akhtar/sketchsaathi/issues).
- Want to help? Fork the repo, run the [tests](#tests), and send a pull request.

## Security

Board links use random ids, only owners can rename or delete boards and pages, drawing data is validated,
logins are rate-limited and production runs with debug off, HTTPS and secure cookies.
Found a problem? Please open an issue.

## Built with

[Django](https://www.djangoproject.com/) · [Channels](https://channels.readthedocs.io/) · [Bootstrap](https://getbootstrap.com/) · hosted on [Vercel](https://vercel.com) with [Neon](https://neon.tech) Postgres

## License

[MIT](LICENSE) © 2026 Md Perwez Akhtar
