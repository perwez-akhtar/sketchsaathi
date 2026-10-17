from rest_framework import serializers

from boards.models import Board, Page


class PageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Page
        fields = ['uuid', 'name', 'position', 'elements', 'background', 'updated_at']
        read_only_fields = ['uuid', 'updated_at']


class PageSummarySerializer(serializers.ModelSerializer):
    """A tab in the board's tab bar (without the drawing itself)."""

    class Meta:
        model = Page
        fields = ['uuid', 'name', 'position', 'background']


class BoardSerializer(serializers.ModelSerializer):
    is_owner = serializers.SerializerMethodField()
    pages = PageSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Board
        fields = ['uuid', 'title', 'is_owner', 'pages', 'created_at', 'updated_at']
        read_only_fields = ['uuid', 'is_owner', 'pages', 'created_at', 'updated_at']

    def get_is_owner(self, board):
        request = self.context.get('request')
        return bool(request and board.owner_id == request.user.id)
