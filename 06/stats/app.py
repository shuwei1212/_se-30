#!/usr/bin/env python3
import json
import os
import platform
import shutil
import signal
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVICE_NAME = "python-stats"
SERVICE_VERSION = "1.0.0"
STARTED_AT = datetime.now(timezone.utc)
STARTED_MONOTONIC = time.monotonic()
REQUEST_LOCK = threading.Lock()
REQUEST_COUNT = 0


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_meminfo():
    values = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                parts = rest.strip().split()
                if not parts:
                    continue
                try:
                    values[key] = int(parts[0])
                except ValueError:
                    continue
    except OSError:
        pass
    return values


def disk_usage():
    try:
        usage = shutil.disk_usage("/")
        return usage.total, usage.free
    except OSError:
        return 0, 0


def load_average():
    try:
        return os.getloadavg()[0]
    except (AttributeError, OSError):
        return 0.0


def snapshot(headers, requests):
    memory = read_meminfo()
    total_memory = memory.get("MemTotal", 0)
    available_memory = memory.get("MemAvailable", memory.get("MemFree", 0))
    disk_total, disk_free = disk_usage()
    forwarded = headers.get("X-Forwarded-For", "")
    client = forwarded.split(",")[0].strip() or headers.get("X-Real-IP", "") or "unknown"

    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "hostname": socket.gethostname(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "pid": os.getpid(),
        "started_at": STARTED_AT.isoformat(),
        "uptime_seconds": round(time.monotonic() - STARTED_MONOTONIC, 1),
        "cpu_count": os.cpu_count() or 1,
        "load_1m": round(load_average(), 2),
        "memory_total_mb": round(total_memory / 1024),
        "memory_available_mb": round(available_memory / 1024),
        "disk_total_gb": round(disk_total / (1024 ** 3), 1),
        "disk_free_gb": round(disk_free / (1024 ** 3), 1),
        "requests": requests,
        "gateway": headers.get("X-Gateway", "direct"),
        "client": client,
        "time": utc_now(),
    }


class StatsHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DockerBoardStats/1.0"
    sys_version = ""

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/health":
            self.send_json(200, {
                "status": "ok",
                "service": SERVICE_NAME,
                "version": SERVICE_VERSION,
                "uptime_seconds": round(time.monotonic() - STARTED_MONOTONIC, 1),
                "time": utc_now(),
            })
            return

        if path in ("/", "/stats"):
            global REQUEST_COUNT
            with REQUEST_LOCK:
                REQUEST_COUNT += 1
                current_count = REQUEST_COUNT
            self.send_json(200, snapshot(self.headers, current_count))
            return

        self.send_json(404, {
            "error": "not_found",
            "path": path,
            "service": SERVICE_NAME,
        })

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Service", SERVICE_NAME)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message, *args):
        if getattr(self, "path", "") == "/health":
            return
        sys.stderr.write("[stats] %s - %s\n" % (self.address_string(), message % args))


def main():
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), StatsHandler)
    server.daemon_threads = True

    def request_shutdown(signum, frame):
        sys.stderr.write("[stats] received signal %s, shutting down\n" % signum)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    print("[stats] listening on http://0.0.0.0:%s" % port, flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        print("[stats] stopped", flush=True)


if __name__ == "__main__":
    main()
