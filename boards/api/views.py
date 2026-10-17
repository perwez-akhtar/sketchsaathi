from django.db import transaction
from django.db.models import Max
from rest_framework import filters, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from boards.models import Board, Page

from .permissions import OwnerCanDelete
from .serializers import BoardSerializer, PageSerializer


class BoardViewSet(viewsets.ModelViewSet):
    """Boards are addressed by uuid. The list only shows the caller's own boards."""

    queryset = Board.objects.prefetch_related('pages')
    serializer_class = BoardSerializer
    lookup_field = 'uuid'
    permission_classes = [permissions.IsAuthenticated, OwnerCanDelete]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title']
    ordering_fields = ['title', 'created_at', 'updated_at']

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == 'list':
            queryset = queryset.filter(owner=self.request.user)
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        board = serializer.save(owner=self.request.user)
        Page.objects.create(board=board, name='Page 1', position=0)

    @action(detail=True, methods=['post'], url_path='pages')
    def add_page(self, request, uuid=None):
        """Add a page (tab) to the end of the board."""
        board = self.get_object()
        serializer = PageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        last = board.pages.aggregate(last=Max('position'))['last']
        page = serializer.save(board=board, position=0 if last is None else last + 1)
        board.save(update_fields=['updated_at'])
        return Response(PageSerializer(page).data, status=status.HTTP_201_CREATED)


class PageViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                  mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """A single page: load, save (elements / background / name / position) or delete.

    Like boards, pages are reached by an unguessable uuid, so anyone signed in
    who has the board link can edit them.
    """

    queryset = Page.objects.select_related('board')
    serializer_class = PageSerializer
    lookup_field = 'uuid'
    permission_classes = [permissions.IsAuthenticated]

    def perform_update(self, serializer):
        page = serializer.save()
        page.board.save(update_fields=['updated_at'])

    def perform_destroy(self, page):
        if page.board.pages.count() <= 1:
            raise ValidationError('A board needs at least one page.')
        board = page.board
        page.delete()
        board.save(update_fields=['updated_at'])
