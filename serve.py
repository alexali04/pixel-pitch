#!/usr/bin/env python3
"""Serve the game locally with caching disabled, so a reload always picks up edits.

    python3 serve.py          # http://localhost:8765
    python3 serve.py 9000     # pick another port
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Pixel Pitch on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
