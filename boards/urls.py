from django.contrib.auth import views as auth_views
from django.urls import path

from .views import BoardLinkView, GuestView, HomeView, LoginView, SignupView

urlpatterns = [
    path('', HomeView.as_view(), name='home'),                           # landing page, or the app when signed in
    path('draw/', GuestView.as_view(), name='guest'),                     # the editor without an account
    path('b/<uuid:board_uuid>/', BoardLinkView.as_view(), name='board'),  # share link; the app then loads it over AJAX
    path('login/', LoginView.as_view(), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('signup/', SignupView.as_view(), name='signup'),
]
