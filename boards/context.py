from pathlib import Path

STATIC = Path(__file__).resolve().parent / 'static' / 'boards'
# changes whenever a css/js file changes, so browsers never reuse a stale copy
ASSET_VERSION = str(int(max((f.stat().st_mtime for f in STATIC.rglob('*') if f.suffix in ('.css', '.js')), default=0)))


def assets(request):
    return {'asset_v': ASSET_VERSION}
