from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from boards.models import Board, Page

from .serializers import BoardSerializer, PageSerializer

ORDERING = {'title', '-title', 'created_at', '-created_at', 'updated_at', '-updated_at'}


@api_view(['GET', 'POST'])
def boards(request):
    if request.method == 'POST':
        serializer = BoardSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            board = serializer.save(owner=request.user)
            Page.objects.create(board=board, name='Page 1', position=0)
        return Response(BoardSerializer(board, context={'request': request}).data, status=status.HTTP_201_CREATED)

    queryset = Board.objects.filter(owner=request.user).prefetch_related('pages')
    if request.GET.get('search'):
        queryset = queryset.filter(title__icontains=request.GET['search'])
    if request.GET.get('ordering') in ORDERING:
        queryset = queryset.order_by(request.GET['ordering'])
    data = BoardSerializer(queryset, many=True, context={'request': request}).data
    return Response({'count': len(data), 'results': data})


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
def board_detail(request, uuid):
    board = get_object_or_404(Board.objects.prefetch_related('pages'), uuid=uuid)

    if request.method == 'DELETE':
        if board.owner_id != request.user.id:
            return Response({'detail': 'Only the owner can delete this board.'}, status=status.HTTP_403_FORBIDDEN)
        board.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method in ('PUT', 'PATCH'):
        if board.owner_id != request.user.id:
            return Response({'detail': 'Only the owner can rename this board.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = BoardSerializer(board, data=request.data, partial=request.method == 'PATCH',
                                     context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()

    return Response(BoardSerializer(board, context={'request': request}).data)


@api_view(['POST'])
def add_page(request, uuid):
    board = get_object_or_404(Board, uuid=uuid)
    serializer = PageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    last = board.pages.aggregate(last=Max('position'))['last']
    page = serializer.save(board=board, position=0 if last is None else last + 1)
    board.save(update_fields=['updated_at'])
    return Response(PageSerializer(page).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
def page_detail(request, uuid):
    page = get_object_or_404(Page.objects.select_related('board'), uuid=uuid)
    board = page.board

    if request.method == 'DELETE':
        if board.owner_id != request.user.id:
            return Response({'detail': 'Only the owner can delete pages.'}, status=status.HTTP_403_FORBIDDEN)
        if board.pages.count() <= 1:
            return Response(['A board needs at least one page.'], status=status.HTTP_400_BAD_REQUEST)
        page.delete()
        board.save(update_fields=['updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method in ('PUT', 'PATCH'):
        serializer = PageSerializer(page, data=request.data, partial=request.method == 'PATCH')
        serializer.is_valid(raise_exception=True)
        serializer.save()
        board.save(update_fields=['updated_at'])

    return Response(PageSerializer(page).data)
