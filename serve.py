#!/usr/bin/env python3
"""Serve the game locally with caching disabled, so a reload always picks up edits.

    python3 serve.py              # http://localhost:8765 (this computer only)
    python3 serve.py 9000         # pick another port
    python3 serve.py --lan        # also reachable from phones on the same Wi-Fi
"""
import http.server
import os
import socket
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def lan_ip():
    # The address this machine uses on the local network (no packets are sent).
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lan = "--lan" in sys.argv[1:]
    port = int(args[0]) if args else 8765
    print(f"Pixel Pitch on http://localhost:{port}")
    if lan:
        ip = lan_ip()
        print(f"On your phone (same Wi-Fi): http://{ip or '<this computer IP>'}:{port}")
        print("Anyone on this network can open it while this runs. Ctrl+C to stop.")
    http.server.ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), NoCacheHandler).serve_forever()
