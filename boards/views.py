import hashlib

from django.conf import settings
from django.contrib.auth import login, logout
from django.core.cache import cache
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from .forms import LoginForm, SignupForm

MAX_LOGIN_FAILURES = 5
LOCKOUT_SECONDS = 15 * 60

FEATURES = [
    ('bi-people', 'Live collaboration', 'Share a link and draw together. See everyone’s cursors and laser pointer as they move.'),
    ('bi-bounding-box', 'Shapes, arrows & freehand', 'Rectangles, diamonds, ellipses, arrows, lines and smooth pen strokes – Shift keeps them neat.'),
    ('bi-fonts', 'Rich text', 'Hand-drawn, normal or code fonts, four sizes, alignment and boxes that wrap.'),
    ('bi-journals', 'Pages like a notebook', 'Organise each board into tabs. Every page has its own canvas and background.'),
    ('bi-image', 'Images & frames', 'Paste or drop images, and group work into named frames that move together.'),
    ('bi-keyboard', 'Fast to use', 'Copy and paste, multi-select, layers, dark mode and keyboard shortcuts for everything.'),
]


@ensure_csrf_cookie
def home(request):
    if request.user.is_authenticated:
        return render(request, 'boards/index.html', {'guest': False, 'live_collab': settings.LIVE_COLLAB})
    return render(request, 'boards/landing.html', {'features': FEATURES})


@login_required
@ensure_csrf_cookie
def board_link(request, board_uuid):
    return render(request, 'boards/index.html', {'guest': False, 'live_collab': settings.LIVE_COLLAB})


def draw(request):
    if request.user.is_authenticated:
        return redirect('home')
    return render(request, 'boards/index.html', {'guest': True, 'live_collab': False})


def login_user(request):
    if request.user.is_authenticated:
        return redirect('home')

    form = LoginForm(request, data=request.POST or None)
    next_url = request.POST.get('next') or request.GET.get('next', '')

    if request.method == 'POST':
        who = request.META.get('REMOTE_ADDR', '') + request.POST.get('username', '').lower()
        key = 'login-fail:' + hashlib.sha256(who.encode()).hexdigest()
        if cache.get(key, 0) >= MAX_LOGIN_FAILURES:
            form.add_error(None, 'Too many failed attempts. Try again in 15 minutes.')
            return render(request, 'boards/auth/login.html', {'form': form, 'next': next_url}, status=429)

    if request.method == 'POST' and form.is_valid():
        cache.delete(key)
        login(request, form.get_user())
        if not form.cleaned_data.get('remember'):
            # session ends when the browser closes
            request.session.set_expiry(0)
        # only follow ?next= to our own site
        safe = url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()},
                                               require_https=request.is_secure())
        return redirect(next_url if safe else 'home')

    if request.method == 'POST':
        cache.set(key, cache.get(key, 0) + 1, LOCKOUT_SECONDS)
    return render(request, 'boards/auth/login.html', {'form': form, 'next': next_url})


@require_POST
def logout_user(request):
    logout(request)
    return redirect('home')


def signup(request):
    if request.user.is_authenticated:
        return redirect('home')

    form = SignupForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        return redirect('home')

    return render(request, 'boards/auth/signup.html', {'form': form})
