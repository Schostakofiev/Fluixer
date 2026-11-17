import base64
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from fluixer.service import ASSETS, OPERATIONS, Operation, json_payload
from fluixer.webapp import Handler
from fluixer.website import create_app


class SharedServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.client = create_app({'FLUIXER_ORIGIN': 'https://example.test',
                                 'FLUIXER_USERNAME': 'tester',
                                 'FLUIXER_PASSWORD': 'test-password'}).test_client()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def local(self, method, path, data=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        try:
            conn.request(method, path, json.dumps(data) if data is not None else None,
                         headers or {'Content-Type': 'application/json'})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def website(self, method, path, data=None):
        headers = {'Authorization': 'Basic ' + base64.b64encode(b'tester:test-password').decode(),
                   'Origin': 'https://example.test'}
        response = self.client.open(path, method=method, base_url='https://example.test',
                                    headers=headers, json=data)
        return response.status_code, dict(response.headers), response.data

    def assert_parity(self, method, path, data=None):
        local = self.local(method, path, data)
        website = self.website(method, path, data)
        self.assertEqual(local[0], 200, path)
        self.assertEqual(website[0], local[0], path)
        self.assertEqual(website[2], local[2], path)
        for name in ('Content-Type', 'Content-Disposition', 'X-Row-Count'):
            self.assertEqual(website[1].get(name), local[1].get(name), (path, name))

    def test_computation_and_download_parity(self):
        for operation in ('display', 'output-plan', 'export', 'calibration-standard'):
            with self.subTest(operation=operation):
                self.assert_parity('POST', '/api/' + operation, {})

    def test_every_public_asset_matches(self):
        for name in ASSETS:
            with self.subTest(asset=name):
                self.assert_parity('GET', '/' + name)

    def test_registry_drives_both_hosts(self):
        with patch.dict(OPERATIONS, {'test-operation': Operation(lambda data: json_payload(data))}):
            self.assert_parity('POST', '/api/test-operation', {'value': 42})
            for request in (self.local, self.website):
                status, headers, _ = request('GET', '/api/test-operation')
                self.assertEqual(status, 405)
                self.assertEqual(headers['Allow'], 'POST')
        for request in (self.local, self.website):
            self.assertEqual(request('POST', '/api/test-operation', {})[0], 404)
            self.assertEqual(request('GET', '/service.py')[0], 404)
            self.assertEqual(request('GET', '/../service.py')[0], 404)

    def test_host_specific_protection_remains(self):
        self.assertEqual(self.local('GET', '/', headers={'Host': 'example.test'})[0], 403)
        self.assertEqual(self.client.get('/', base_url='https://example.test').status_code, 401)


if __name__ == '__main__':
    unittest.main()
