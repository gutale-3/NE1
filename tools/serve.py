#!/usr/bin/env python3
"""Local preview server that resolves clean URLs the way Cloudflare Pages does.

    python3 tools/serve.py [port]

`python3 -m http.server` can't serve the site's extensionless links
(/products, /product/ds-2ce16d0t-exipf-3-6mm-o-std) because they have no .html
on the end. This maps /foo to foo.html, and /foo/ to foo/index.html.
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        resolved = super().translate_path(path)
        candidate = pathlib.Path(resolved)
        if not candidate.exists() and not path.endswith("/"):
            with_suffix = candidate.with_name(candidate.name + ".html")
            if with_suffix.is_file():
                return str(with_suffix)
        return resolved


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(Handler, directory=str(ROOT))
    print(f"Serving {ROOT} on http://localhost:{port} — Ctrl-C to stop")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
