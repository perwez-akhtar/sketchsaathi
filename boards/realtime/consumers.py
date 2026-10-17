import re
import uuid

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from boards.models import Board

# Events a client may send. `join`/`leave` are produced by the server itself.
# Drawing events carry the uuid of the page they apply to; `pages` means the tab list changed.
DRAWING_EVENTS = {'add', 'update', 'remove', 'clear', 'order'}
PRESENCE_EVENTS = {'cursor', 'hello'}
HEX_COLOR = re.compile(r'#[0-9a-fA-F]{6}')


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class BoardConsumer(AsyncJsonWebsocketConsumer):
    """Relays drawing events and presence (who is here, where their cursor is)
    between everyone who has the same board open."""

    async def connect(self):
        user = self.scope.get('user')
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user = user
        self.board_uuid = self.scope['url_route']['kwargs']['board_uuid']
        if not await self.board_exists():
            await self.close(code=4404)
            return
        self.cid = uuid.uuid4().hex[:8]       # identifies this connection (one user can have several tabs)
        self.group = f'board_{self.board_uuid}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.broadcast({'type': 'join'})

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.broadcast({'type': 'leave'})
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            return
        kind = content.get('type')
        if kind in DRAWING_EVENTS:
            await self.broadcast(content)
        elif kind == 'background' and isinstance(content.get('color'), str) and HEX_COLOR.fullmatch(content['color']):
            await self.broadcast({'type': 'background', 'color': content['color'], 'page': content.get('page')})
        elif kind == 'pages':
            await self.broadcast({'type': 'pages'})
        elif kind == 'hello':
            await self.broadcast({'type': 'hello'})
        elif kind == 'laser' and is_number(content.get('x')) and is_number(content.get('y')):
            await self.broadcast({'type': 'laser', 'x': content['x'], 'y': content['y'],
                                  'start': content.get('start') is True, 'page': content.get('page')})
        elif kind == 'cursor' and is_number(content.get('x')) and is_number(content.get('y')):
            await self.broadcast({'type': 'cursor', 'x': content['x'], 'y': content['y'], 'page': content.get('page')})

    async def broadcast(self, event):
        # Identity is always set by the server, never trusted from the client.
        event = {**event, 'user': self.user.get_username(), 'cid': self.cid}
        await self.channel_layer.group_send(
            self.group, {'type': 'board.event', 'sender': self.channel_name, 'event': event},
        )

    async def board_event(self, message):
        if message['sender'] != self.channel_name:
            await self.send_json(message['event'])

    @database_sync_to_async
    def board_exists(self):
        return Board.objects.filter(uuid=self.board_uuid).exists()
