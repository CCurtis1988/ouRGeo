"""Dependency-free adversarial tests of the retention acknowledgement boundary."""
import asyncio
import importlib.util
import pathlib
import tempfile
import unittest
from contextlib import asynccontextmanager

file = pathlib.Path(__file__).resolve().parents[1]/'electron/main/context/hindsight-gateway.py'
spec = importlib.util.spec_from_file_location('hindsight_gateway', file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.events = []
        self.fail_cleanup = False
        self.namespace = '00000000-0000-4000-8000-000000000001'
        owner = self

        class Database:
            async def close(self):
                owner.events.append('database-close')

        async def connect():
            return Database()

        async def compact(unused):
            owner.events.append('compact')
            owner.assertTrue((pathlib.Path(owner.directory.name)/'retention-pending').exists())
            if owner.fail_cleanup:
                raise RuntimeError('Controlled storage failure')

        class Application:
            @asynccontextmanager
            async def lifespan_context(self, unused):
                owner.events.append('open')
                try:
                    yield
                finally:
                    owner.events.append('close')

            def __init__(self):
                self.router = self

            async def __call__(self, scope, receive, send):
                await receive()
                # An upstream disconnect watcher must not receive an infinite
                # stream of the same body (the real API found this failure).
                with owner.assertRaises(TimeoutError):
                    await asyncio.wait_for(receive(), 0.005)
                owner.events.append('mutated')
                await send({'type': 'http.response.start', 'status': 200, 'headers': []})
                await send({'type': 'http.response.body', 'body': b'{"success":true}'})

        self.gateway = module.HindsightRetentionGateway(Application, connect, compact, self.directory.name, b'x'*32)

    async def request(self, method='DELETE', namespace=None, token=None, origin=None):
        headers = [(b'host', b'127.0.0.1:43123'), (b'authorization', ('Bearer '+(token or self.gateway.token(self.namespace))).encode())]
        if origin:
            headers.append((b'origin', origin.encode()))
        scope = {'type': 'http', 'method': method, 'path': '/v1/default/banks/'+(namespace or self.namespace)+'/documents/00000000-0000-4000-8000-000000000002', 'headers': headers, 'query_string': b''}
        delivered = False

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': b'', 'more_body': False}
            await asyncio.Future()

        messages = []

        async def send(message):
            if message.get('status') == 200:
                self.assertFalse((pathlib.Path(self.directory.name)/'retention-pending').exists())
                self.assertTrue(self.gateway.healthy)
            messages.append(message)

        await self.gateway(scope, receive, send)
        return messages[0]['status']

    async def test_acknowledges_only_after_workers_close_and_retention_completes(self):
        async with self.gateway.lifespan():
            self.assertEqual(await self.request(), 200)
            self.assertEqual(self.events, ['open', 'mutated', 'close', 'compact', 'database-close', 'open'])

    async def test_cleanup_failure_blocks_reads_and_restart_recovers_before_open(self):
        async with self.gateway.lifespan():
            self.fail_cleanup = True
            self.assertEqual(await self.request(), 503)
            self.assertEqual(await self.request('GET'), 503)
            self.assertTrue((pathlib.Path(self.directory.name)/'retention-pending').exists())
        self.fail_cleanup = False
        self.events.clear()
        async with self.gateway.lifespan():
            self.assertEqual(self.events, ['compact', 'database-close', 'open'])
            self.assertFalse((pathlib.Path(self.directory.name)/'retention-pending').exists())

    async def test_credentials_origin_and_bank_cannot_expand_scope(self):
        async with self.gateway.lifespan():
            self.assertEqual(await self.request(token='foreign'), 403)
            self.assertEqual(await self.request(namespace='00000000-0000-4000-8000-000000000003'), 403)
            self.assertEqual(await self.request(origin='https://foreign.example.invalid'), 403)
            self.assertEqual(self.events, ['open'])


if __name__ == '__main__':
    unittest.main()
