import argparse
import http.client
import http.server
import signal
import socket
import subprocess
import sys
import threading


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, socket_path):
        super().__init__('localhost')
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.socket_path)


parser = argparse.ArgumentParser()
parser.add_argument('--socket', required=True)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
if not command:
    parser.error('a command is required')


class Bridge(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def forward(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length else None
        headers = {name: value for name, value in self.headers.items() if name.lower() in ('authorization', 'content-type', 'accept', 'origin')}
        connection = UnixConnection(args.socket)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            reply = connection.getresponse()
            self.send_response(reply.status)
            self.send_header('Content-Type', reply.getheader('Content-Type', 'application/json'))
            self.end_headers()
            while chunk := reply.read(65536):
                self.wfile.write(chunk)
        except OSError:
            if not self.wfile.closed:
                self.send_error(502)
        finally:
            connection.close()

    do_GET = forward
    do_HEAD = forward
    do_POST = forward
    do_PUT = forward
    do_PATCH = forward
    do_DELETE = forward

    def log_message(self, format, *args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Bridge)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
child = subprocess.Popen(command)


def stop(signum, frame):
    child.terminate()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    status = child.wait()
finally:
    server.shutdown()
    server.server_close()
sys.exit(status)
