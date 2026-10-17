from django.urls import path

from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('draw/', views.draw, name='guest'),
    path('b/<uuid:board_uuid>/', views.board_link, name='board'),
    path('login/', views.login_user, name='login'),
    path('logout/', views.logout_user, name='logout'),
    path('signup/', views.signup, name='signup'),
]
