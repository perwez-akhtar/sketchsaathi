from rest_framework import permissions


class OwnerCanDelete(permissions.BasePermission):
    """Anyone signed in with the link can read and edit a board; only its owner can delete it."""

    def has_object_permission(self, request, view, board):
        if request.method == 'DELETE':
            return board.owner_id == request.user.id
        return True
