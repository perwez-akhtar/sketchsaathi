from django.contrib.auth import login
from django.contrib.auth import views as auth_views
from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import redirect
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import CreateView, TemplateView

from .forms import LoginForm, SignupForm

FEATURES = [
    ('bi-people', 'Live collaboration', 'Share a link and draw together. See everyone’s cursors and laser pointer as they move.'),
    ('bi-bounding-box', 'Shapes, arrows & freehand', 'Rectangles, diamonds, ellipses, arrows, lines and smooth pen strokes – Shift keeps them neat.'),
    ('bi-fonts', 'Rich text', 'Hand-drawn, normal or code fonts, four sizes, alignment and boxes that wrap.'),
    ('bi-journals', 'Pages like a notebook', 'Organise each board into tabs. Every page has its own canvas and background.'),
    ('bi-image', 'Images & frames', 'Paste or drop images, and group work into named frames that move together.'),
    ('bi-keyboard', 'Fast to use', 'Copy and paste, multi-select, layers, dark mode and keyboard shortcuts for everything.'),
]


@method_decorator(ensure_csrf_cookie, name='dispatch')
class HomeView(TemplateView):
    """The drawing app for signed-in users; the landing page for everyone else."""

    def get_template_names(self):
        return ['boards/index.html' if self.request.user.is_authenticated else 'boards/landing.html']

    def get_context_data(self, **kwargs):
        return super().get_context_data(features=FEATURES, guest=False, **kwargs)


class BoardLinkView(LoginRequiredMixin, HomeView):
    """A shared board link (/b/<uuid>/). The app reads the id and loads the board itself."""


class GuestView(TemplateView):
    """The full editor without an account (like Excalidraw). Drawings stay in this browser
    until the visitor signs up or logs in, when they are moved into their account."""

    template_name = 'boards/index.html'

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('home')
        return super().dispatch(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        return super().get_context_data(guest=True, **kwargs)


class LoginView(auth_views.LoginView):
    template_name = 'boards/auth/login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True

    def form_valid(self, form):
        response = super().form_valid(form)
        if not form.cleaned_data.get('remember'):
            self.request.session.set_expiry(0)           # signed out when the browser closes
        return response


class SignupView(CreateView):
    form_class = SignupForm
    template_name = 'boards/auth/signup.html'

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect('home')
        return super().dispatch(request, *args, **kwargs)

    def form_valid(self, form):
        user = form.save()
        login(self.request, user)
        return redirect('home')
