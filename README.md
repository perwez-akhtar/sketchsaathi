# SketchSaathi

A collaborative sketching whiteboard. Sign up, draw with pen, line, rectangle and ellipse tools,
save boards, export them as PNG, and share a link so several people can draw on the same board in real time.

- Accounts: sign up / log in; the board list shows your own boards.
- Sharing: a board's link contains an unguessable id. Anyone signed in with the link can edit it live;
  only the owner can delete it.

Built with Django, Django REST Framework and Channels (WebSockets), on MySQL/MariaDB.

## Run

    python -m venv venv
    venv\Scripts\activate
    pip install -r requirements-dev.txt
    python manage.py migrate
    python manage.py runserver

Open http://127.0.0.1:8000/ and sign up. Run tests with `python manage.py test`. See [docs/setup.md](docs/setup.md) for database settings.

## Structure

    config/                 project settings, URL map, ASGI entry point
    boards/
      models.py             Board (title + drawn elements as JSON)
      admin.py
      views.py, urls.py     pages, login, logout, signup         -> / /login/ /signup/
      forms.py              signup form
      api/                  REST API: serializers, views, permissions  -> /api/boards/
      realtime/             WebSocket consumer and routing       -> /ws/boards/<id>/
      templates/boards/     layouts/, includes/, index.html
      static/boards/        css/ and js/ (api, canvas, collab, app)
      tests/                api, pages and realtime tests
    docs/                   setup notes
