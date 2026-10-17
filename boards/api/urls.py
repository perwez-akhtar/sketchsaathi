from django.urls import path

from . import views

urlpatterns = [
    path('boards/', views.boards, name='api-boards'),
    path('boards/<uuid:uuid>/', views.board_detail, name='api-board'),
    path('boards/<uuid:uuid>/pages/', views.add_page, name='api-add-page'),
    path('pages/<uuid:uuid>/', views.page_detail, name='api-page'),
]
