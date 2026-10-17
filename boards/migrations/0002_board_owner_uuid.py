import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def fill_uuids(apps, schema_editor):
    Board = apps.get_model('boards', 'Board')
    for board in Board.objects.all():
        board.uuid = uuid.uuid4()
        board.save(update_fields=['uuid'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('boards', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='board',
            name='owner',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='boards', to=settings.AUTH_USER_MODEL,
            ),
        ),
        # Add as nullable first so existing rows can each get their own value.
        migrations.AddField(
            model_name='board',
            name='uuid',
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(fill_uuids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='board',
            name='uuid',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
