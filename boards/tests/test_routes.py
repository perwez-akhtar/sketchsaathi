from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from boards.models import Board, Page

UNKNOWN = '00000000-0000-0000-0000-000000000000'


class RouteAccessTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', password='pw-12345-x')
        self.other = User.objects.create_user('other', password='pw-12345-x')
        self.staff = User.objects.create_user('staff', password='pw-12345-x', is_staff=True, is_superuser=True)
        self.board = Board.objects.create(title='Plan', owner=self.owner)
        self.page = Page.objects.create(board=self.board, name='Page 1')
        self.page2 = Page.objects.create(board=self.board, name='Page 2', position=1)

    def client_for(self, user=None):
        client = self.client_class()
        if user:
            client.force_login(user)
        return client

    def test_page_routes(self):
        link = f'/b/{self.board.uuid}/'
        table = [
            # url, anonymous, signed in
            ('/', 200, 200),
            ('/draw/', 200, 302),
            (link, 302, 200),
            ('/login/', 200, 302),
            ('/signup/', 200, 302),
            ('/admin/', 302, 302),
            ('/admin/boards/board/', 302, 302),
        ]
        for url, anonymous, signed_in in table:
            self.assertEqual(self.client_for().get(url).status_code, anonymous, f'anonymous {url}')
            self.assertEqual(self.client_for(self.other).get(url).status_code, signed_in, f'signed in {url}')

    def test_share_link_sends_visitors_to_login_then_back(self):
        link = f'/b/{self.board.uuid}/'
        self.assertRedirects(self.client_for().get(link), f'/login/?next={link}')

    def test_admin_is_for_staff_only(self):
        self.assertEqual(self.client_for(self.other).get('/admin/').status_code, 302)
        self.assertEqual(self.client_for(self.other).get('/admin/boards/board/').status_code, 302)
        self.assertEqual(self.client_for(self.staff).get('/admin/').status_code, 200)
        self.assertEqual(self.client_for(self.staff).get('/admin/boards/board/').status_code, 200)

    def test_logout_only_by_post(self):
        for user in (None, self.other):
            self.assertEqual(self.client_for(user).get('/logout/').status_code, 405)
        client = self.client_for(self.other)
        self.assertEqual(client.post('/logout/').status_code, 302)
        self.assertEqual(client.get('/').templates[0].name, 'boards/landing.html')

    def fresh_data(self):
        Board.objects.all().delete()
        self.board = Board.objects.create(title='Plan', owner=self.owner)
        self.page = Page.objects.create(board=self.board, name='Page 1')
        self.page2 = Page.objects.create(board=self.board, name='Page 2', position=1)

    def test_api_routes_by_role(self):
        board = lambda: f'/api/boards/{self.board.uuid}/'
        page = lambda: f'/api/pages/{self.page.uuid}/'
        extra = lambda: f'/api/pages/{self.page2.uuid}/'
        # method, url, body, anonymous, owner, another signed-in user
        table = [
            ('get', lambda: '/api/boards/', None, 403, 200, 200),
            ('get', board, None, 403, 200, 200),
            ('patch', board, {'title': 'New'}, 403, 200, 403),
            ('post', lambda: board() + 'pages/', {'name': 'Added'}, 403, 201, 201),
            ('get', page, None, 403, 200, 200),
            ('patch', page, {'name': 'Edited'}, 403, 200, 200),
            ('delete', extra, None, 403, 204, 403),
            ('delete', board, None, 403, 204, 403),
        ]
        for method, url, body, anonymous, owner, other in table:
            for user, expected in ((None, anonymous), (self.owner, owner), (self.other, other)):
                self.fresh_data()
                client = APIClient()
                if user:
                    client.force_authenticate(user)
                res = getattr(client, method)(url(), body, format='json')
                who = user.username if user else 'anonymous'
                self.assertEqual(res.status_code, expected, f'{method} {url()} as {who}')

    def test_unknown_ids_are_not_found(self):
        client = APIClient()
        client.force_authenticate(self.other)
        for url in (f'/api/boards/{UNKNOWN}/', f'/api/pages/{UNKNOWN}/', '/api/boards/abc/', '/api/pages/1/'):
            self.assertEqual(client.get(url).status_code, 404, url)

    def test_unknown_routes_are_not_found(self):
        for url in ('/api/', '/api/users/', '/api/boards', '/nothing/', '/static/../manage.py'):
            self.assertIn(self.client_for(self.owner).get(url).status_code, (301, 404), url)


class SqlInjectionTests(TestCase):
    ATTACKS = [
        "' OR '1'='1", "' OR 1=1 --", "'; DROP TABLE boards_board; --", '" OR ""="',
        "1; SELECT SLEEP(5)", "\\' UNION SELECT username, password FROM auth_user --", '%', '_', '\\', '\x00',
    ]

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user('alice', password='pw-12345-x')
        self.bob = User.objects.create_user('bob', password='pw-12345-x')
        self.mine = Board.objects.create(title='Alice plan', owner=self.alice)
        self.secret = Board.objects.create(title='Bob secret', owner=self.bob)
        for board in (self.mine, self.secret):
            Page.objects.create(board=board, name='Page 1')
        self.api = APIClient()
        self.api.force_authenticate(self.alice)

    def assert_database_intact(self):
        self.assertEqual(Board.objects.count(), 2)
        self.assertEqual(User.objects.count(), 2)
        self.assertTrue(User.objects.get(username='bob').check_password('pw-12345-x'))

    def test_search_cannot_reach_other_users_boards(self):
        for attack in self.ATTACKS:
            res = self.api.get('/api/boards/', {'search': attack})
            self.assertEqual(res.status_code, 200, attack)
            titles = [b['title'] for b in res.data['results']]
            self.assertNotIn('Bob secret', titles, attack)
        self.assert_database_intact()

    def test_search_treats_wildcards_as_plain_text(self):
        for wildcard in ('%', '_'):
            self.assertEqual(self.api.get('/api/boards/', {'search': wildcard}).data['count'], 0)

    def test_ordering_only_accepts_known_columns(self):
        for attack in ("title; DROP TABLE boards_board", "-title,(SELECT 1)", "owner_id", "(CASE WHEN 1=1 THEN 1 END)"):
            res = self.api.get('/api/boards/', {'ordering': attack})
            self.assertEqual(res.status_code, 200, attack)
        self.assert_database_intact()

    def test_ids_in_urls_must_be_real_uuids(self):
        for attack in ("1' OR '1'='1", "0 OR 1=1", "' UNION SELECT 1 --", "1;DROP TABLE boards_board"):
            for path in ('/api/boards/%s/', '/api/pages/%s/', '/b/%s/'):
                self.assertEqual(self.api.get(path % attack).status_code, 404, path % attack)
        self.assert_database_intact()

    def test_attack_text_in_titles_and_names_is_stored_as_plain_text(self):
        for attack in self.ATTACKS[:6]:
            res = self.api.post('/api/boards/', {'title': attack}, format='json')
            self.assertEqual(res.status_code, 201, attack)
            self.assertEqual(Board.objects.get(uuid=res.data['uuid']).title, attack)
            page = self.api.post(f"/api/boards/{res.data['uuid']}/pages/", {'name': attack[:100]}, format='json')
            self.assertEqual(page.status_code, 201)
        self.assertEqual(User.objects.count(), 2)
        self.assertTrue(Board.objects.filter(owner=self.bob).count() == 1)

    def test_login_and_signup_ignore_injection(self):
        for attack in self.ATTACKS[:4]:
            res = self.client.post('/login/', {'username': attack, 'password': attack})
            self.assertContains(res, 'alert-danger')
        res = self.client.post('/login/', {'username': "alice' --", 'password': 'x'})
        self.assertNotEqual(res.status_code, 302)
        res = self.client.post('/signup/', {'email': "x'; DROP TABLE auth_user; --",
                                            'password1': 'Str0ng-pass-99', 'password2': 'Str0ng-pass-99'})
        self.assertContains(res, 'is-invalid')
        self.assert_database_intact()

    def test_drawing_data_with_injection_text_is_just_data(self):
        page = Page.objects.get(board=self.mine)
        shape = {'id': "a'; DROP TABLE boards_page; --", 'type': 'text', 'text': "' OR 1=1 --", 'x': 0, 'y': 0}
        res = self.api.patch(f'/api/pages/{page.uuid}/', {'elements': [shape]}, format='json')
        self.assertEqual(res.status_code, 200)
        page.refresh_from_db()
        self.assertEqual(page.elements[0]['text'], "' OR 1=1 --")
        self.assertEqual(Page.objects.count(), 2)
