import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('boards', '0002_board_owner_uuid'),
    ]

    operations = [
        migrations.AddField(
            model_name='board',
            name='background',
            field=models.CharField(default='#ffffff', max_length=7, validators=[django.core.validators.RegexValidator('^#[0-9a-fA-F]{6}$', 'Enter a colour like #ffffff.')]),
        ),
    ]
