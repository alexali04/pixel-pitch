#!/usr/bin/env python3
"""Serve the game locally with caching disabled, so a reload always picks up edits.

    python3 serve.py              # http://localhost:8765 (this computer only)
    python3 serve.py 9000         # pick another port
    python3 serve.py --lan        # also reachable from phones on the same Wi-Fi
"""
import base64
import http.server
import json
import os
import socket
import sys
import time


FEEDBACK_DIR = "feedback"
MAX_UPLOAD = 25 * 1024 * 1024


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # The pause menu's "Export for feedback": POST /feedback with JSON
    # { "png": "data:image/png;base64,...", "state": {...}, "note": "..." }.
    # Saved as feedback/<timestamp>.png and .json (names chosen here, never by the page).
    def do_POST(self):
        if self.path != "/feedback":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_UPLOAD:
            self.send_error(413)
            return
        try:
            body = json.loads(self.rfile.read(n))
            os.makedirs(FEEDBACK_DIR, exist_ok=True)
            stamp = time.strftime("%Y-%m-%d_%H%M%S")
            base = os.path.join(FEEDBACK_DIR, stamp)
            png = body.get("png") or ""
            if png.startswith("data:image/png;base64,"):
                with open(base + ".png", "wb") as f:
                    f.write(base64.b64decode(png.split(",", 1)[1]))
            with open(base + ".json", "w") as f:
                json.dump({"note": body.get("note", ""), **(body.get("state") or {})}, f, indent=1)
        except (ValueError, OSError) as e:
            self.send_error(400, str(e))
            return
        out = json.dumps({"saved": base}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


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
