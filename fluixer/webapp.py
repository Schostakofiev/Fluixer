"""Local-only UI. Run: python -m fluixer.webapp [--port 8765] [--no-browser]."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from urllib.parse import urlsplit
import webbrowser
from .service import OPERATIONS, asset_payload, dispatch


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass

    def send(self,status,body,content_type,extra=None):
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        for key,value in (extra or {}).items():self.send_header(key,value)
        self.end_headers();self.wfile.write(body)

    def error(self,status,message):
        self.send(status,json.dumps({'error':message},ensure_ascii=False).encode(), 'application/json; charset=utf-8')

    def local_request(self):
        expected=f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host')!=expected:
            self.error(403,'Open this page using the local server address');return False
        origin=self.headers.get('Origin')
        if origin is not None and origin!=f'http://{expected}':
            self.error(403,'Request origin mismatch');return False
        return True

    def do_GET(self):
        if not self.local_request():return
        path=urlsplit(self.path).path
        if path.startswith('/api/'):
            operation=path[5:]
            if operation not in OPERATIONS:self.error(404,'Endpoint not found');return
            self.send(405,json.dumps({'error':'Use POST for this endpoint'}).encode(),
                      'application/json',{'Allow':'POST'});return
        payload=asset_payload(path.removeprefix('/'))
        if payload is None:self.error(404,'Page not found');return
        self.send(200,payload.body,payload.content_type,payload.headers)

    def do_POST(self):
        if not self.local_request():return
        path=urlsplit(self.path).path
        operation=path[5:] if path.startswith('/api/') else None
        if operation not in OPERATIONS:self.error(404,'Endpoint not found');return
        try:
            count=int(self.headers.get('Content-Length','0'))
            if not 0<count<=4194304:raise ValueError('Request must not exceed 4 MB')
            payload=dispatch(operation,json.loads(self.rfile.read(count)))
        except (ValueError,TypeError,OverflowError) as exc:
            self.error(400,str(exc));return
        self.send(200,payload.body,payload.content_type,payload.headers)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    args=parser.parse_args()
    if not 0<=args.port<=65535:parser.error('port must be 0..65535')
    try:server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError as exc:parser.error(str(exc))
    address=f'http://127.0.0.1:{server.server_port}'
    print(f'Fluixel: {address}\nPress Ctrl+C to close.',flush=True)
    if not args.no_browser:webbrowser.open(address)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
