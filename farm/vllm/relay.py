"""TCP -> Unix-socket relay in front of vLLM, started and stopped with it by serve.sh.

    relay.py <host> <port> <unix socket>

Why it exists (found 2026-10-05, WSL 2.6.3, networkingMode=mirrored): vLLM binds its TCP port when it starts but
calls listen() only once the model is loaded, 1.5-2.5 min later. Mirrored networking stops forwarding a port that
sat bound that long without listening: SYNs time out from WSL and Windows gets "refused", although `ss` shows
LISTEN. Reproduced with a plain Python socket (bind, listen 75 s later); a 12-15 s gap still works. vLLM has no
flag that listens earlier, so it serves on --uds and this relay, which listens the moment it binds, carries TCP.

Each TCP connection gets its own Unix connection; when either side leaves, both are closed (a full close, not a
half-close), so a client that disconnects makes vLLM abort its request. Before vLLM is up the socket does not
exist and a connection is closed at once: callers see the server as down. Logs nothing per connection.
"""
import asyncio
import sys

HOST, PORT, SOCK = sys.argv[1], int(sys.argv[2]), sys.argv[3]


async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except OSError:
        pass
    finally:
        writer.close()


async def handle(client_r, client_w):
    try:
        up_r, up_w = await asyncio.open_unix_connection(SOCK)
    except OSError as e:
        # No socket file, or nobody listening on it yet: vLLM is starting or gone. Anything else is worth a line.
        if not isinstance(e, (FileNotFoundError, ConnectionRefusedError)):
            print(f"[relay] could not reach {SOCK}: {e!r}", flush=True)
        client_w.close()
        return
    await asyncio.gather(pipe(client_r, up_w), pipe(up_r, client_w))


async def main():
    server = await asyncio.start_server(handle, HOST, PORT, reuse_address=True, backlog=2048)
    print(f"[relay] {HOST}:{PORT} -> {SOCK}", flush=True)
    async with server:
        await server.serve_forever()


try:
    import uvloop  # in vLLM's venv; plain asyncio works too
    run = uvloop.run
except ImportError:
    run = asyncio.run
run(main())
