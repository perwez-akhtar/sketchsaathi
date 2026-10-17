def no_store(get_response):
    # pages and API answers are per user, so browsers and proxies must not keep them
    def middleware(request):
        response = get_response(request)
        if not request.path.startswith('/static/'):
            response['Cache-Control'] = 'private, no-store'
        return response
    return middleware
