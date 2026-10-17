import json

from rest_framework import serializers

from boards.models import Board, Page

ELEMENT_TYPES = {'pen', 'line', 'arrow', 'rectangle', 'diamond', 'ellipse', 'text', 'image', 'frame'}
MAX_ELEMENTS = 20000
MAX_ELEMENTS_BYTES = 5_000_000


class PageSerializer(serializers.ModelSerializer):
    def validate_elements(self, elements):
        if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
            raise serializers.ValidationError('Too many shapes on one page.')
        for element in elements:
            if not isinstance(element, dict) or element.get('type') not in ELEMENT_TYPES:
                raise serializers.ValidationError('Unknown shape.')
            if not isinstance(element.get('id'), str) or len(element['id']) > 64:
                raise serializers.ValidationError('Bad shape id.')
        if len(json.dumps(elements)) > MAX_ELEMENTS_BYTES:
            raise serializers.ValidationError('This page is too large.')
        return elements

    def validate_position(self, position):
        if position < 0:
            raise serializers.ValidationError('Position cannot be negative.')
        return position

    class Meta:
        model = Page
        fields = ['uuid', 'name', 'position', 'elements', 'background', 'updated_at']
        read_only_fields = ['uuid', 'updated_at']


class PageSummarySerializer(serializers.ModelSerializer):
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
