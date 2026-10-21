"""
A-share fund flow proxy server.
Static hosting + EastMoney API reverse proxy.
Endpoints: GET /api/minute?code=XXXXXX&market=1, GET /api/daily?code=XXXXXX&market=1
Note: TLS verification disabled (local proxy only).
"""
import http.server
import socketserver
import ssl
import sys
import json
import urllib.request
import urllib.parse
import time

PORT = 8765
HOST = "127.0.0.1"
ROOT = "."

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}

EAST_MONEY_MINUTE = "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get"
EAST_MONEY_DAILY = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
EAST_MONEY_QUOTE = "https://push2.eastmoney.com/api/qt/stock/get"
EAST_MONEY_KLINE = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
EAST_MONEY_TRENDS = "https://push2.eastmoney.com/api/qt/stock/trends2/get"

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def proxy_east_money(target, params, retries=4):
    # EastMoney push2/push2his TLS is flaky from this network. Few quick retries.
    import subprocess
    qs = urllib.parse.urlencode(params)
    url = target + "?" + qs
    last_err = None
    for attempt in range(retries):
        try:
            r = subprocess.run(
                ["curl.exe", "-sS", "-k", "-m", "6",
                 "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0",
                 "-H", "Referer: https://quote.eastmoney.com/",
                 url],
                capture_output=True, timeout=10,
            )
            raw = r.stdout or b""
            # Defensive: strip UTF-8 BOM if upstream ever attaches one, and force
            # the charset on the response so the browser never falls back to a
            # locale-default decode.
            if raw.startswith(b"\xef\xbb\xbf"):
                raw = raw[3:]
            if r.returncode == 0 and raw.lstrip()[:1] == b"{":
                return 200, {"Content-Type": "application/json; charset=utf-8"}, raw
            last_err = Exception("rc=" + str(r.returncode))
        except Exception as e:
            last_err = e
        time.sleep(0.4)
    raise last_err or Exception("all retries failed")
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # This app is edited live and every endpoint returns live market data,
        # so a cached bundle just pins the browser to pre-fix code. Force a
        # revalidation on every request instead of trusting the cache.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path, qs)
        else:
            super().do_GET()

    def handle_api(self, path, qs):
        code = qs.get("code", [""])[0].strip().upper()
        market = qs.get("market", [""])[0]
        if not code or not market:
            self.send_error(400, "missing code or market")
            return
        if not code.isalnum() or len(code) != 6:
            self.send_error(400, "invalid code (need 6 alnum)")
            return
        try:
            market = int(market)
        except ValueError:
            self.send_error(400, "invalid market")
            return

        params = {
            "secid": str(market) + "." + code,
            "fields1": "f1,f2,f3,f4",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        }
        if path == "/api/minute":
            params["klt"] = "1"
            params["lmt"] = "0"
            target = EAST_MONEY_MINUTE
        elif path == "/api/daily":
            params["klt"] = "101"
            params["lmt"] = "15"
            target = EAST_MONEY_DAILY
        elif path == "/api/quote":
            target = EAST_MONEY_QUOTE
            params["fields"] = "f43,f44,f45,f46,f60,f57,f58,f169,f170"
        elif path == "/api/kline":
            target = EAST_MONEY_KLINE
            params["fields1"] = "f1,f2,f3,f4,f5,f6"
            params["fields2"] = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
            params["klt"] = qs.get("klt", ["101"])[0]
            params["fqt"] = qs.get("fqt", ["1"])[0]
            params["lmt"] = qs.get("lmt", ["20"])[0]
            params["end"] = qs.get("end", ["20991231"])[0]
        elif path == "/api/detail":
            target = EAST_MONEY_QUOTE
            params["fields"] = ",".join([
                "f43", "f44", "f45", "f46", "f47", "f48", "f49", "f50", "f51", "f52",
                "f57", "f58", "f60", "f71", "f84", "f85", "f86", "f116", "f117",
                "f127", "f152", "f162", "f167", "f168", "f169", "f170", "f171",
            ])
        elif path == "/api/trends":
            target = EAST_MONEY_TRENDS
            params["fields1"] = "f1,f2,f3,f4,f5,f6,f7,f8"
            params["fields2"] = "f51,f52,f53,f54,f55,f56,f57,f58"
            params["iscr"] = "0"
            params["iscca"] = "0"
            params["ndays"] = qs.get("ndays", ["1"])[0]
        else:
            self.send_error(404, "unknown api")
            return

        try:
            status, headers, body = proxy_east_money(target, params)
        except Exception as e:
            import traceback
            sys.stderr.write("PROXY ERR " + repr(e) + "\\n" + traceback.format_exc() + "\\n")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            for k, v in CORS_HEADERS.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e), "target": target}).encode("utf-8"))
            return

        self.send_response(status)
        ct = headers.get("Content-Type", "application/json")
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        print("serving " + ROOT + " at http://" + HOST + ":" + str(PORT), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
