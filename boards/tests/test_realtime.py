from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import AnonymousUser, User
from django.test import TransactionTestCase

from boards.models import Board
from boards.realtime.routing import websocket_urlpatterns

router = URLRouter(websocket_urlpatterns)


def connect(board_uuid, user):
    communicator = WebsocketCommunicator(router, f'/ws/boards/{board_uuid}/')
    communicator.scope['user'] = user
    return communicator


class BoardSocketTests(TransactionTestCase):
    async def setup_board(self):
        make = database_sync_to_async(User.objects.create_user)
        alice, bob = await make('alice', password='pw-12345-x'), await make('bob', password='pw-12345-x')
        board = await database_sync_to_async(Board.objects.create)(title='Live', owner=alice)
        return alice, bob, board

    async def open_pair(self):
        """Alice joins first, then Bob; Alice's `join` notification is consumed here."""
        alice_user, bob_user, board = await self.setup_board()
        alice, bob = connect(board.uuid, alice_user), connect(board.uuid, bob_user)
        self.assertTrue((await alice.connect())[0])
        self.assertTrue((await bob.connect())[0])
        join = await alice.receive_json_from()
        return alice, bob, join

    async def test_join_announces_user(self):
        alice, bob, join = await self.open_pair()
        self.assertEqual((join['type'], join['user']), ('join', 'bob'))
        self.assertTrue(join['cid'])
        await alice.disconnect()
        await bob.disconnect()

    async def test_drawing_event_reaches_others_with_server_set_identity(self):
        alice, bob, _ = await self.open_pair()
        # A client can't pretend to be someone else.
        await alice.send_json_to({'type': 'add', 'element': {'id': 'e1', 'type': 'line'}, 'user': 'mallory'})

        got = await bob.receive_json_from()
        self.assertEqual((got['type'], got['element']['id'], got['user']), ('add', 'e1', 'alice'))
        self.assertTrue(await alice.receive_nothing())
        await alice.disconnect()
        await bob.disconnect()

    async def test_update_and_cursor_events_are_relayed(self):
        alice, bob, _ = await self.open_pair()
        await alice.send_json_to({'type': 'update', 'element': {'id': 'e1', 'x': 5}})
        self.assertEqual((await bob.receive_json_from())['type'], 'update')
        await alice.send_json_to({'type': 'laser', 'x': 1, 'y': 2, 'start': True, 'page': 'p1'})
        laser = await bob.receive_json_from()
        self.assertEqual((laser['type'], laser['start'], laser['page']), ('laser', True, 'p1'))
        await alice.send_json_to({'type': 'cursor', 'x': 10, 'y': 20.5})
        cursor = await bob.receive_json_from()
        self.assertEqual((cursor['x'], cursor['y'], cursor['user']), (10, 20.5, 'alice'))
        await alice.disconnect()
        await bob.disconnect()

    async def test_background_change_is_relayed(self):
        alice, bob, _ = await self.open_pair()
        await alice.send_json_to({'type': 'background', 'color': '#fdf6e3', 'page': 'p1'})
        got = await bob.receive_json_from()
        self.assertEqual((got['type'], got['color'], got['page']), ('background', '#fdf6e3', 'p1'))
        await alice.send_json_to({'type': 'pages', 'junk': 1})
        self.assertEqual(await bob.receive_json_from(), {'type': 'pages', 'user': 'alice', 'cid': got['cid']})
        await alice.disconnect()
        await bob.disconnect()

    async def test_invalid_events_are_ignored(self):
        alice, bob, _ = await self.open_pair()
        for bad in ({'type': 'boom'}, {'type': 'cursor', 'x': 'a', 'y': 1}, {'type': 'join'}, ['list'],
                    {'type': 'background', 'color': 'red; x'}):
            await alice.send_json_to(bad)
        self.assertTrue(await bob.receive_nothing())
        await alice.disconnect()
        await bob.disconnect()

    async def test_leave_is_announced(self):
        alice, bob, _ = await self.open_pair()
        await bob.disconnect()
        leave = await alice.receive_json_from()
        self.assertEqual((leave['type'], leave['user']), ('leave', 'bob'))
        await alice.disconnect()

    async def test_anonymous_users_are_rejected(self):
        _, _, board = await self.setup_board()
        connected, code = await connect(board.uuid, AnonymousUser()).connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4401)

    async def test_unknown_board_is_rejected(self):
        alice, _, _ = await self.setup_board()
        connected, code = await connect('00000000-0000-0000-0000-000000000000', alice).connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4404)
