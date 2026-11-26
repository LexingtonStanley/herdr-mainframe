"""One bounded poll of the local Blender MCP add-on (or a forwarded port)."""
import base64
import hashlib
import json
import socket
import sys
import tempfile
import time
from pathlib import Path

PREFIX = "# mainframe viewport\n"
MARKER = "HERDR_SNAPSHOT:"
# Bump when the Blender-side data returned by probe.py changes.
MODULE = "_herdr_mainframe_viewport_v2"


def execute(port, code):
    deadline = time.monotonic() + 8
    payload = json.dumps({"type": "execute_code", "params": {"code": PREFIX + code}})
    with socket.create_connection(("127.0.0.1", port), timeout=2) as sock:
        sock.sendall(payload.encode())
        buf = bytearray()
        while len(buf) < 8 * 1024 * 1024:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError()
            sock.settimeout(left)
            part = sock.recv(65536)
            if not part:
                raise ValueError("Blender closed the connection before replying")
            buf.extend(part)
            if part.rstrip().endswith(b"}"):
                try:
                    reply = json.loads(buf)
                except (ValueError, UnicodeError):
                    continue
                if reply.get("status") != "success":
                    raise ValueError("Blender rejected the viewport request: " + str(reply.get("message", ""))[:220])
                # execute_code redirects process-wide stdout. The add-on's socket
                # threads can print connection notices in the same captured output.
                for line in reply["result"]["result"].splitlines():
                    if line.startswith(MARKER):
                        return json.loads(line[len(MARKER):])
                raise ValueError("Blender did not return a scene snapshot")
        raise ValueError("Blender reply exceeds 8 MiB")


def poll(port, track):
    request = (f"import sys,json\nprobe=sys.modules.get({MODULE!r})\n"
               f"snapshot=json.dumps(probe.poll({track!r}) if probe else None, separators=(',',':'))\n"
               f"print('\\n' + {MARKER!r} + snapshot)")
    result = execute(port, request)
    if result is None:
        source = Path(__file__).with_name("probe.py").read_text()
        install = (f"import types,sys\nprobe=types.ModuleType({MODULE!r})\n"
                   f"exec({source!r},probe.__dict__)\nsys.modules[{MODULE!r}]=probe\n")
        result = execute(port, install + request)
    return result


def cache(frame, home):
    data = base64.b64decode(frame.pop("png"), validate=True)
    folder = home / "data" / "mainframe-blender"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / ("view-" + hashlib.sha256(data).hexdigest()[:20] + ".png")
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as tmp:
            tmp.write(data)
        Path(tmp.name).replace(path)
    path.touch()
    for old in sorted(folder.glob("view-*.png"), key=lambda p: p.stat().st_mtime, reverse=True)[4:]:
        old.unlink(missing_ok=True)
    frame["path"] = str(path.relative_to(home))


if __name__ == "__main__":
    try:
        result = poll(int(sys.argv[1]), sys.argv[2] == "track")
        if result.get("frameImage"):
            cache(result["frameImage"], Path(sys.argv[3]))
        print(json.dumps(result))
    except (socket.timeout, TimeoutError):
        sys.exit("Blender is busy: no complete reply in eight seconds.")
    except ConnectionRefusedError:
        sys.exit("Offline: start the Blender MCP server or check the forwarded port.")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.exit(str(exc))
