from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from boards.models import Board, Page


class BoardApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345-x')
        self.bob = User.objects.create_user('bob', password='pw-12345-x')

    def make_board(self, title='Board', owner=None):
        board = Board.objects.create(title=title, owner=owner or self.alice)
        Page.objects.create(board=board, name='Page 1')
        return board

    def test_requires_login(self):
        self.assertEqual(self.client.get('/api/boards/').status_code, 403)

    def test_create_sets_owner_and_first_page(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post('/api/boards/', {'title': 'Wireframe'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data['is_owner'])
        self.assertEqual([p['name'] for p in res.data['pages']], ['Page 1'])
        self.assertEqual(Board.objects.get(uuid=res.data['uuid']).owner, self.alice)

    def test_list_shows_only_own_boards_and_search_works(self):
        self.make_board('Wireframe')
        self.make_board('Secret', owner=self.bob)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get('/api/boards/').data['count'], 1)
        self.assertEqual(self.client.get('/api/boards/?search=wire').data['count'], 1)
        self.assertEqual(self.client.get('/api/boards/?search=secret').data['count'], 0)

    def test_collaborator_can_rename_but_not_delete_board(self):
        board = self.make_board('Shared')
        self.client.force_authenticate(self.bob)
        url = f'/api/boards/{board.uuid}/'
        res = self.client.patch(url, {'title': 'Renamed'}, format='json')
        self.assertEqual((res.status_code, res.data['is_owner']), (200, False))
        self.assertEqual(self.client.delete(url).status_code, 403)

    def test_owner_can_delete_board_and_its_pages(self):
        board = self.make_board('Mine')
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/boards/{board.uuid}/').status_code, 204)
        self.assertFalse(Page.objects.exists())


class PageApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='pw-12345-x')
        self.bob = User.objects.create_user('bob', password='pw-12345-x')
        self.board = Board.objects.create(title='Notes', owner=self.alice)
        self.first = Page.objects.create(board=self.board, name='Page 1')

    def test_add_pages_in_order(self):
        self.client.force_authenticate(self.bob)          # collaborators can add pages too
        url = f'/api/boards/{self.board.uuid}/pages/'
        second = self.client.post(url, {'name': 'Ideas'}, format='json')
        third = self.client.post(url, {'name': 'Todo'}, format='json')
        self.assertEqual((second.status_code, second.data['position']), (201, 1))
        self.assertEqual(third.data['position'], 2)
        board = self.client.get(f'/api/boards/{self.board.uuid}/').data
        self.assertEqual([p['name'] for p in board['pages']], ['Page 1', 'Ideas', 'Todo'])
        self.assertNotIn('elements', board['pages'][0])     # tab list stays light

    def test_save_and_load_page_drawing(self):
        self.client.force_authenticate(self.alice)
        url = f'/api/pages/{self.first.uuid}/'
        shapes = [{'id': 'a', 'type': 'rectangle', 'x': 1, 'y': 2, 'width': 3, 'height': 4}]
        res = self.client.patch(url, {'elements': shapes, 'background': '#1e293b', 'name': 'Sketch'}, format='json')
        self.assertEqual(res.status_code, 200)
        page = self.client.get(url).data
        self.assertEqual((page['elements'], page['background'], page['name']), (shapes, '#1e293b', 'Sketch'))

    def test_background_is_validated(self):
        self.client.force_authenticate(self.alice)
        url = f'/api/pages/{self.first.uuid}/'
        for bad in ('blue', '#fff', '#ffffffff', 'red; x'):
            self.assertEqual(self.client.patch(url, {'background': bad}, format='json').status_code, 400)

    def test_cannot_delete_last_page(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f'/api/pages/{self.first.uuid}/').status_code, 400)
        extra = Page.objects.create(board=self.board, name='Page 2', position=1)
        self.assertEqual(self.client.delete(f'/api/pages/{extra.uuid}/').status_code, 204)

    def test_pages_require_login(self):
        self.assertEqual(self.client.get(f'/api/pages/{self.first.uuid}/').status_code, 403)
