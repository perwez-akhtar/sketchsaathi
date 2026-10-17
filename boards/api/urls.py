from rest_framework.routers import DefaultRouter

from .views import BoardViewSet, PageViewSet

router = DefaultRouter()
router.register('boards', BoardViewSet)
router.register('pages', PageViewSet)

urlpatterns = router.urls
