import uuid

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


def move_drawings_to_pages(apps, schema_editor):
    """Each existing board keeps its drawing as its first page."""
    Board = apps.get_model('boards', 'Board')
    Page = apps.get_model('boards', 'Page')
    for board in Board.objects.all():
        Page.objects.create(board=board, name='Page 1', position=0,
                            elements=board.elements, background=board.background)


def move_pages_back(apps, schema_editor):
    Board = apps.get_model('boards', 'Board')
    for board in Board.objects.all():
        first = board.pages.order_by('position', 'created_at').first()
        if first:
            board.elements, board.background = first.elements, first.background
            board.save(update_fields=['elements', 'background'])


class Migration(migrations.Migration):

    dependencies = [
        ('boards', '0003_board_background'),
    ]

    operations = [
        migrations.CreateModel(
            name='Page',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('name', models.CharField(default='Page 1', max_length=100)),
                ('position', models.PositiveIntegerField(default=0)),
                ('elements', models.JSONField(blank=True, default=list)),
                ('background', models.CharField(default='#ffffff', max_length=7, validators=[
                    django.core.validators.RegexValidator(r'^#[0-9a-fA-F]{6}\Z', 'Enter a colour like #ffffff.')])),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('board', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name='pages', to='boards.board')),
            ],
            options={
                'ordering': ['position', 'created_at'],
            },
        ),
        migrations.RunPython(move_drawings_to_pages, move_pages_back),
        migrations.RemoveField(model_name='board', name='background'),
        migrations.RemoveField(model_name='board', name='elements'),
    ]
