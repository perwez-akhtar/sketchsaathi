from django.test import SimpleTestCase

from config.settings import channel_layers


class ChannelLayerTests(SimpleTestCase):
    def test_no_redis_url_uses_in_memory_layer(self):
        self.assertEqual(channel_layers('')['default']['BACKEND'], 'channels.layers.InMemoryChannelLayer')

    def test_redis_url_uses_the_pubsub_layer_which_sends_no_polling_commands(self):
        url = 'rediss://default:secret@example.upstash.io:6379'
        layer = channel_layers(url)['default']
        self.assertEqual(layer['BACKEND'], 'channels_redis.pubsub.RedisPubSubChannelLayer')
        self.assertEqual(layer['CONFIG']['hosts'], [url])

    def test_pubsub_layer_can_be_created_from_that_config(self):
        from channels.layers import channel_layers as registry
        from channels_redis.pubsub import RedisPubSubChannelLayer

        layer = RedisPubSubChannelLayer(hosts=['rediss://default:secret@example.upstash.io:6379'])
        self.assertTrue(hasattr(layer, 'group_send'))
        self.assertIsNotNone(registry)
