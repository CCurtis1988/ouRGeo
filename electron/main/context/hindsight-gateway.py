"""Serial, authenticated retention boundary for the dedicated local profile.

The upstream ASGI application has no listening socket of its own. Every request
and background worker is drained before PostgreSQL maintenance. A durable dirty
marker makes interrupted mutations require maintenance before the next read.
This module neither installs Hindsight nor approves a deployment by itself.
"""
import asyncio
import hashlib
import hmac
import json
import os
import pathlib
import re
from contextlib import asynccontextmanager


class HindsightRetentionGateway:
    def __init__(self, make_app, connect, compact, directory, secret):
        self.make_app, self.connect, self.compact = make_app, connect, compact
        self.root = pathlib.Path(directory)
        self.secret = secret
        self.lock = asyncio.Lock()
        self.application = self.lifetime = None
        self.waiters = 0
        self.healthy = False
        self.maintenance_count = 0

    def token(self, namespace):
        return namespace + '.' + hmac.new(self.secret, namespace.encode(), hashlib.sha256).hexdigest()

    def marker(self, dirty):
        path = self.root/'retention-pending'
        if dirty:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            try:
                os.write(descriptor, b'quiescent-retention-v1\n')
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        else:
            path.unlink(missing_ok=True)
        descriptor = os.open(self.root, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    async def open(self):
        application = self.make_app()
        lifetime = application.router.lifespan_context(application)
        await lifetime.__aenter__()
        self.application, self.lifetime = application, lifetime

    async def close(self):
        lifetime, self.lifetime = self.lifetime, None
        self.application = None
        if lifetime:
            await lifetime.__aexit__(None, None, None)

    async def maintain(self):
        self.healthy = False
        await self.close()
        connection = await self.connect()
        try:
            await self.compact(connection)
            self.maintenance_count += 1
        finally:
            await connection.close()
        await self.open()
        self.marker(False)
        self.healthy = True

    @asynccontextmanager
    async def lifespan(self):
        # The private database must already be running, but no API/worker is
        # started until recovery maintenance has completed.
        if (self.root/'retention-pending').exists():
            await self.maintain()
        else:
            await self.open()
            self.healthy = True
        try:
            yield
        finally:
            self.healthy = False
            await self.close()

    async def reply(self, send, status, value):
        body = json.dumps(value).encode()
        await send({'type': 'http.response.start', 'status': status, 'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
        await send({'type': 'http.response.body', 'body': body})

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'lifespan':
            event = await receive()
            assert event['type'] == 'lifespan.startup'
            try:
                async with self.lifespan():
                    await send({'type': 'lifespan.startup.complete'})
                    assert (await receive())['type'] == 'lifespan.shutdown'
                await send({'type': 'lifespan.shutdown.complete'})
            except Exception:
                await send({'type': 'lifespan.startup.failed', 'message': 'Repair the dedicated retention profile before starting it.'})
            return
        if scope['type'] != 'http':
            return
        headers = {key.lower(): value for key, value in scope.get('headers', [])}
        host = headers.get(b'host', b'').decode('ascii', errors='replace')
        origin = headers.get(b'origin')
        if not re.fullmatch(r'127\.0\.0\.1:[1-9][0-9]{0,4}', host) or origin is not None and origin != ('http://'+host).encode():
            return await self.reply(send, 403, {'error': 'LOCAL_PROFILE_REFUSED'})
        token = headers.get(b'authorization', b'').decode('ascii', errors='replace')
        match = re.fullmatch(r'Bearer ([a-f0-9-]{36})\.([a-f0-9]{64})', token)
        if not match or not hmac.compare_digest(token[7:], self.token(match[1])):
            return await self.reply(send, 403, {'error': 'LOCAL_PROFILE_REFUSED'})
        namespace = match[1]
        path, method, query = scope['path'], scope['method'], scope.get('query_string', b'')
        prefix = '/v1/default/banks/'+namespace
        relative = path[len(prefix):] if path.startswith(prefix+'/') else None
        allowed = (method == 'GET' and path == '/health' and not query
                   or relative == '/memories' and method == 'POST' and not query
                   or relative == '/memories/recall' and method == 'POST' and not query
                   or relative is not None and re.fullmatch(r'/documents/[a-f0-9-]{36}', relative) and method in ('GET', 'DELETE') and not query
                   or relative == '/operations' and method == 'GET' and query == b'type=batch_retain&limit=100&offset=0'
                   or relative is not None and re.fullmatch(r'/operations/[a-f0-9-]{36}', relative) and method == 'GET' and not query
                   or relative is not None and re.fullmatch(r'/operations/[a-f0-9-]{36}/delete', relative) and method == 'DELETE' and not query)
        if not allowed:
            return await self.reply(send, 403, {'error': 'LOCAL_PROFILE_REFUSED'})
        if self.waiters >= 8:
            return await self.reply(send, 503, {'error': 'LOCAL_PROFILE_BUSY'})
        self.waiters += 1
        try:
            async with asyncio.timeout(15):
                async with self.lock:
                    if not self.healthy:
                        return await self.reply(send, 503, {'error': 'LOCAL_RETENTION_PENDING'})
                    body = b''
                    while True:
                        event = await receive()
                        if event['type'] == 'http.disconnect':
                            return
                        body += event.get('body', b'')
                        if len(body) > 65536:
                            return await self.reply(send, 413, {'error': 'LOCAL_PROFILE_LIMIT'})
                        if not event.get('more_body'):
                            break
                    if method == 'POST':
                        try:
                            value = json.loads(body)
                            if relative == '/memories':
                                assert set(value) == {'items', 'async'} and value['async'] is False
                                assert isinstance(value['items'], list) and 0 < len(value['items']) <= 10
                                for item in value['items']:
                                    assert set(item) == {'content', 'document_id', 'timestamp', 'metadata'}
                                    assert isinstance(item['content'], str) and 0 < len(item['content']) <= 4000
                                    assert re.fullmatch(r'[a-f0-9-]{36}', item['document_id'])
                            else:
                                assert set(value).issubset({'query', 'budget', 'max_tokens', 'trace', 'temporal_window'})
                                assert isinstance(value['query'], str) and len(value['query']) <= 512
                                assert value['budget'] == 'low' and value['trace'] is False and 0 < value['max_tokens'] <= 2000
                        except (ValueError, TypeError, KeyError, AssertionError):
                            return await self.reply(send, 403, {'error': 'LOCAL_PROFILE_REFUSED'})
                    mutation = method == 'DELETE' or relative == '/memories'
                    if mutation:
                        self.marker(True)
                    messages, response_bytes = [], 0
                    async def captured(message):
                        nonlocal response_bytes
                        response_bytes += len(message.get('body', b''))
                        if response_bytes > 2000000:
                            raise RuntimeError('Bounded upstream response exceeded.')
                        messages.append(message)
                    delivered = False
                    async def received():
                        nonlocal delivered
                        if not delivered:
                            delivered = True
                            return {'type': 'http.request', 'body': body, 'more_body': False}
                        return await receive()
                    try:
                        await self.application(scope, received, captured)
                    finally:
                        if mutation:
                            # A failed response or disconnect is not evidence
                            # that the database was unchanged. Retain the marker
                            # on every cleanup failure and block further reads.
                            await self.maintain()
                    for message in messages:
                        await send(message)
        except (Exception, asyncio.CancelledError):
            if (self.root/'retention-pending').exists():
                self.healthy = False
            await self.reply(send, 503, {'error': 'LOCAL_RETENTION_PENDING'})
        finally:
            self.waiters -= 1
