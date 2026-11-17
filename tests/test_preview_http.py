import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from fluixer.webapp import Handler
from fluixer.service import display_payload

class PreviewHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,method,path,data=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        try:
            conn.request(method,path,body=json.dumps(data) if data is not None else None,headers={'Content-Type':'application/json'})
            response=conn.getresponse()
            return response.status,response.getheader('Allow'),response.read()
        finally:conn.close()
    def test_get_no_longer_computes_preview(self):
        for path in ['/api/display','/api/display?cylinder=invalid']:
            status,allow,body=self.request('GET',path)
            self.assertEqual(status,405);self.assertEqual(allow,'POST')
    def test_post_payload_and_validation(self):
        for data in [{},{'pattern':{'type':'empty'}},{'pattern':{'type':'spatial-brush','windows':[[.1,.2]]}}]:
            status,_,body=self.request('POST','/api/display',data)
            self.assertEqual(status,200)
            self.assertEqual(json.loads(body),json.loads(json.dumps(display_payload(data))))
        self.assertEqual(self.request('POST','/api/display',{'calibration':'original'})[0],400)
    def test_static_page_unchanged(self):
        self.assertEqual(self.request('GET','/')[0],200)

if __name__=='__main__':unittest.main()
