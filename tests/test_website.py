import base64
import json
import importlib.util
import threading
import unittest
from unittest.mock import patch

@unittest.skipUnless(importlib.util.find_spec('flask'), 'Install requirements-web.txt')
class WebsiteTests(unittest.TestCase):
    def setUp(self):
        from fluixel.website import create_app
        self.config={'FLUIXER_ORIGIN':'https://fluixer.example','FLUIXER_USERNAME':'guest','FLUIXER_PASSWORD':'test-password-for-ci-only'}
        self.app=create_app(self.config)
        self.client=self.app.test_client()
        self.base='https://fluixer.example'
        self.headers={'Authorization':'Basic '+base64.b64encode(b'guest:test-password-for-ci-only').decode(),'Origin':self.base}
    def test_auth(self):
        for path in ['/','/app.js','/api/display','/api/image','/api/export','/api/step','/api/tube-step']:
            r=self.client.get(path,base_url=self.base)
            self.assertEqual(r.status_code,401)
            self.assertIn('Basic',r.headers['WWW-Authenticate'])
        r=self.client.get('/',base_url=self.base,headers=self.headers)
        self.assertEqual(r.status_code,200)
        self.assertNotIn(b'{{VERSION}}',r.data)
        self.assertEqual(r.headers['Cache-Control'],'no-store')
    def test_config_host_health(self):
        from fluixel.website import create_app
        for changes in [{'FLUIXER_PASSWORD':''},{'FLUIXER_ORIGIN':'http://fluixer.example'},{'FLUIXER_ORIGIN':'https://fluixer.example/path'}]:
            with self.assertRaises(ValueError):create_app({**self.config,**changes})
        self.assertEqual(self.client.get('/healthz',base_url=self.base).json,{'status':'ok'})
        self.assertEqual(self.client.get('/',base_url='https://wrong.example',headers=self.headers).status_code,403)
        self.assertEqual(self.client.get('/',base_url=self.base,headers={**self.headers,'Authorization':'Basic Zm9vOmJhcg=='}).status_code,401)
    def test_origin_and_limits(self):
        for origin in ['', 'https://other.example','null']:
            self.assertEqual(self.client.post('/api/display',base_url=self.base,headers={**self.headers,'Origin':origin},json={}).status_code,403)
        self.assertEqual(self.client.post('/api/display',base_url=self.base,headers=self.headers,json=[]).status_code,400)
        self.assertEqual(self.client.post('/api/display',base_url=self.base,headers=self.headers,data='x'*(4*1024*1024+1),content_type='application/json').status_code,413)
    def test_core_and_export(self):
        from fluixel.webapp import preview,csv_payload
        from fluixel.pipeline import CylinderSettings
        from fluixel.compensation import curve_settings
        data={'calibration':'compensated','pattern':{'type':'spatial-brush','windows':[[.1,.2]]}}
        r=self.client.post('/api/display',base_url=self.base,headers=self.headers,json=data)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json,json.loads(json.dumps(preview('compensated',('spatial-brush',((.1,.2),)),curve_settings(),CylinderSettings()))))
        r=self.client.post('/api/export',base_url=self.base,headers=self.headers,json=data)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.data,csv_payload(data)[0])
        self.assertEqual(self.client.get('/api/display',base_url=self.base,headers=self.headers).status_code,200)
    def test_assets(self):
        for path in ['/VERSION','/website.py','/vendor/models/u2netp.onnx','/.env','/api/missing']:
            self.assertEqual(self.client.get(path,base_url=self.base,headers=self.headers).status_code,404)
        for path in ['/app.js','/css/tokens.css','/fonts/open/Geist-Regular.ttf']:
            response=self.client.get(path,base_url=self.base,headers=self.headers)
            self.assertEqual(response.status_code,200)
            response.close()
    def test_busy(self):
        entered,release=threading.Event(),threading.Event()
        def slow(*args):
            entered.set();release.wait(5);return {'ok':True}
        with patch('fluixel.website.preview',slow):
            t=threading.Thread(target=lambda:self.app.test_client().post('/api/display',base_url=self.base,headers=self.headers,json={}))
            t.start()
            try:
                self.assertTrue(entered.wait(3))
                r=self.client.post('/api/display',base_url=self.base,headers=self.headers,json={})
                self.assertEqual(r.status_code,503)
                self.assertEqual(r.headers['Retry-After'],'1')
            finally:release.set();t.join(5)
        self.assertEqual(self.client.post('/api/display',base_url=self.base,headers=self.headers,json={}).status_code,200)
