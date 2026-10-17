import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

hex_color = RegexValidator(r'^#[0-9a-fA-F]{6}\Z', 'Enter a colour like #ffffff.')


class Board(models.Model):
    # uuid is the public id used in share links; ids can't be guessed
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='boards',
    )
    title = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title


class Page(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='pages')
    name = models.CharField(max_length=100, default='Page 1')
    position = models.PositiveIntegerField(default=0)
    elements = models.JSONField(default=list, blank=True)
    background = models.CharField(max_length=7, default='#ffffff', validators=[hex_color])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position', 'created_at']

    def __str__(self):
        return f'{self.board} / {self.name}'
