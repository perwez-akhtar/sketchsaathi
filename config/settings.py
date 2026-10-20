import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def load_env_file(path):
    # reads KEY=value lines from a private .env file; real environment variables win
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))


load_env_file(BASE_DIR / '.env')


SECRET_KEY = os.environ.get(
    'SECRET_KEY', 'django-insecure-dev-only-change-me-in-production'
)

# debug pages show settings and variables, so they are only on by default for local development
# (no SECRET_KEY set, not on Vercel); anywhere else you must turn them on yourself
LOCAL_DEV = not os.environ.get('SECRET_KEY') and not os.environ.get('VERCEL')
DEBUG = os.environ.get('DEBUG', 'True' if LOCAL_DEV else 'False').lower() in ('1', 'true', 'yes')

if not DEBUG and (SECRET_KEY.startswith('django-insecure') or len(SECRET_KEY) < 32):
    raise ImproperlyConfigured('Set a long, random SECRET_KEY when DEBUG is off.')

ON_VERCEL = bool(os.environ.get('VERCEL'))

ALLOWED_HOSTS = [h for h in os.environ.get('ALLOWED_HOSTS', '').split(',') if h]
if ON_VERCEL:
    ALLOWED_HOSTS += ['.vercel.app']

# a free Redis (e.g. Upstash) lets several servers share live updates; the Vercel integration sets one of these
REDIS_URL = os.environ.get('REDIS_URL') or os.environ.get('KV_URL') or ''

# on Vercel live collaboration needs that shared Redis; locally one process is enough
LIVE_COLLAB = os.environ.get('LIVE_COLLAB', 'True' if (REDIS_URL or not ON_VERCEL) else 'False').lower() in ('1', 'true', 'yes')


INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'boards',
]

try:
    import django_extensions  # noqa: F401 (dev-only shell_plus, show_urls)
    INSTALLED_APPS.append('django_extensions')
except ImportError:
    pass

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'boards.middleware.no_store',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'boards.context.assets',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')

if DATABASE_URL:
    DATABASES = {'default': dj_database_url.parse(DATABASE_URL.replace('postgres://', 'postgresql://'),
                                                  conn_max_age=60, conn_health_checks=True)}
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.environ.get('DB_NAME', 'sketchsaathi'),
            'USER': os.environ.get('DB_USER', 'root'),
            'PASSWORD': os.environ.get('DB_PASSWORD', ''),
            'HOST': os.environ.get('DB_HOST', '127.0.0.1'),
            'PORT': os.environ.get('DB_PORT', '3306'),
            'OPTIONS': {
                'charset': 'utf8mb4',
                'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
            },
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


STATIC_URL = 'static/'
WHITENOISE_USE_FINDERS = True  # serve static files straight from the apps, no collectstatic step


MAILERS = {
    'default': {
        'BACKEND': 'django.core.mail.backends.console.EmailBackend',
    },
}

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.UserRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {'user': '600/min'},
}

ASGI_APPLICATION = 'config.asgi.application'

def channel_layers(redis_url):
    if not redis_url:
        # one process only, fine for local development
        return {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
    # pub/sub keeps one connection open and sends no polling commands, which suits a free Redis plan
    return {'default': {
        'BACKEND': 'channels_redis.pubsub.RedisPubSubChannelLayer',
        'CONFIG': {'hosts': [redis_url]},
    }}


CHANNEL_LAYERS = channel_layers(REDIS_URL)

DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'home'
LOGOUT_REDIRECT_URL = 'home'

# secure cookies and headers in production
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
CSRF_TRUSTED_ORIGINS = [o for o in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',') if o]
if ON_VERCEL:
    CSRF_TRUSTED_ORIGINS += ['https://*.vercel.app']
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_SSL_REDIRECT = os.environ.get('SECURE_SSL_REDIRECT', 'True').lower() in ('1', 'true', 'yes')
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
