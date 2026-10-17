import re
import time
import uuid

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from boards.models import Board

DRAWING_EVENTS = {'add', 'update', 'remove', 'clear', 'order'}
PRESENCE_EVENTS = {'cursor', 'hello'}
HEX_COLOR = re.compile(r'#[0-9a-fA-F]{6}')
MAX_MESSAGE_CHARS = 1_000_000
MAX_MESSAGES_PER_SECOND = 120


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class BoardConsumer(AsyncJsonWebsocketConsumer):
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
        self.cid = uuid.uuid4().hex[:8]
        self.window_start = time.monotonic()
        self.window_count = 0
        self.group = f'board_{self.board_uuid}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.broadcast({'type': 'join'})

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.broadcast({'type': 'leave'})
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if not text_data or len(text_data) > MAX_MESSAGE_CHARS:
            await self.close(code=1009)
            return
        now = time.monotonic()
        if now - self.window_start >= 1:
            self.window_start, self.window_count = now, 0
        self.window_count += 1
        if self.window_count > MAX_MESSAGES_PER_SECOND:
            return
        await super().receive(text_data=text_data, **kwargs)

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
        # identity always comes from the server, never from the client
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
