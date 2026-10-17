from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient, APITestCase

from boards.models import Board, Page
from config.asgi import application


class ApiAccessTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345-x')
        self.bob = User.objects.create_user('bob', password='pw-12345-x')
        self.board = Board.objects.create(title='Mine', owner=self.alice)
        self.page = Page.objects.create(board=self.board, name='Page 1')
        self.extra = Page.objects.create(board=self.board, name='Page 2', position=1)

    def test_every_endpoint_needs_login(self):
        urls = [
            ('get', '/api/boards/'), ('post', '/api/boards/'),
            ('get', f'/api/boards/{self.board.uuid}/'), ('delete', f'/api/boards/{self.board.uuid}/'),
            ('post', f'/api/boards/{self.board.uuid}/pages/'),
            ('get', f'/api/pages/{self.page.uuid}/'), ('patch', f'/api/pages/{self.page.uuid}/'),
            ('delete', f'/api/pages/{self.page.uuid}/'),
        ]
        for method, url in urls:
            res = getattr(self.client, method)(url, {}, format='json')
            self.assertIn(res.status_code, (401, 403), f'{method} {url}')
        self.assertEqual(Board.objects.count(), 1)

    def test_board_ids_cannot_be_guessed_or_listed(self):
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get('/api/boards/').data['count'], 0)
        self.assertEqual(self.client.get('/api/boards/1/').status_code, 404)
        self.assertEqual(self.client.get('/api/pages/2/').status_code, 404)

    def test_only_the_owner_can_delete_pages(self):
        self.client.force_authenticate(self.bob)
        res = self.client.delete(f'/api/pages/{self.extra.uuid}/')
        self.assertEqual(res.status_code, 403)
        self.assertTrue(Page.objects.filter(pk=self.extra.pk).exists())
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/pages/{self.extra.uuid}/').status_code, 204)

    def test_pages_cannot_be_moved_to_another_board(self):
        other = Board.objects.create(title='Other', owner=self.bob)
        self.client.force_authenticate(self.alice)
        self.client.patch(f'/api/pages/{self.page.uuid}/', {'board': other.pk, 'uuid': 'x'}, format='json')
        self.page.refresh_from_db()
        self.assertEqual(self.page.board_id, self.board.pk)

    def test_bad_drawing_data_is_rejected(self):
        self.client.force_authenticate(self.alice)
        url = f'/api/pages/{self.page.uuid}/'
        bad = [
            'not a list', [1, 2], [{'type': 'script', 'id': 'a'}], [{'type': 'pen'}],
            [{'type': 'pen', 'id': 'x' * 100}], [{'type': 'pen', 'id': 'a'}] * 20001,
        ]
        for elements in bad:
            res = self.client.patch(url, {'elements': elements}, format='json')
            self.assertEqual(res.status_code, 400, str(elements)[:40])
        shape = {'type': 'pen', 'id': 'a', 'points': [[1, 2]]}
        self.assertEqual(self.client.patch(url, {'elements': [shape]}, format='json').status_code, 200)

    def test_csrf_is_enforced_for_browser_sessions(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.alice)
        res = client.patch(f'/api/pages/{self.page.uuid}/', {'name': 'Hacked'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.page.refresh_from_db()
        self.assertEqual(self.page.name, 'Page 1')


class LoginProtectionTests(TestCase):
    def setUp(self):
        cache.clear()
        User.objects.create_user('alice', password='pw-12345-x')

    def test_too_many_failures_locks_the_login(self):
        for _ in range(5):
            res = self.client.post('/login/', {'username': 'alice', 'password': 'wrong'})
            self.assertEqual(res.status_code, 200)
        locked = self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x'})
        self.assertContains(locked, 'Too many failed attempts', status_code=429)

    def test_a_good_login_clears_the_counter(self):
        for _ in range(3):
            self.client.post('/login/', {'username': 'alice', 'password': 'wrong'})
        res = self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x'})
        self.assertEqual(res.status_code, 302)

    def test_login_will_not_redirect_to_other_sites(self):
        res = self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x',
                                           'next': 'https://evil.example/steal'})
        self.assertRedirects(res, '/', fetch_redirect_response=False)

    def test_logout_needs_post(self):
        self.client.login(username='alice', password='pw-12345-x')
        self.assertEqual(self.client.get('/logout/').status_code, 405)

    def test_session_cookie_is_httponly(self):
        res = self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x'})
        self.assertTrue(res.cookies['sessionid']['httponly'])


class PageHeaderTests(TestCase):
    def test_pages_cannot_be_framed(self):
        self.assertEqual(self.client.get('/').headers['X-Frame-Options'], 'DENY')


class SocketOriginTests(TransactionTestCase):
    async def test_other_websites_cannot_open_a_socket(self):
        path = '/ws/boards/00000000-0000-0000-0000-000000000000/'
        evil = WebsocketCommunicator(application, path, headers=[(b'origin', b'http://evil.example')])
        self.assertFalse((await evil.connect())[0])
        own = WebsocketCommunicator(application, path, headers=[(b'origin', b'http://testserver')])
        connected, code = await own.connect()
        self.assertEqual((connected, code), (False, 4401))
