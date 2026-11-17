"""Authenticated website entry point. Local preview remains in webapp.py."""
import hmac
import os
import threading
from urllib.parse import urlsplit

from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import HTTPException

from .service import OPERATIONS, asset_payload, dispatch


def create_app(config=None):
    settings = dict(os.environ if config is None else config)
    origin = settings.get('FLUIXER_ORIGIN') or settings.get('RENDER_EXTERNAL_URL', '')
    origin = origin.rstrip('/')
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.netloc or url.path or url.query or url.fragment or url.username or url.password:
        raise ValueError('Set FLUIXER_ORIGIN to the HTTPS website origin, without a path')
    username = settings.get('FLUIXER_USERNAME', '')
    password = settings.get('FLUIXER_PASSWORD', '')
    if not username or ':' in username or len(password) < 6:
        raise ValueError('Set FLUIXER_USERNAME and FLUIXER_PASSWORD (at least 6 characters)')

    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=4*1024*1024)
    admission = threading.BoundedSemaphore(1)

    @app.before_request
    def protect():
        if request.host.lower() != url.netloc.lower():
            return jsonify(error='Unrecognized website host'), 403
        # A health check returns no application data and requires no credentials.
        if request.path == '/healthz' and request.method == 'GET':
            return None
        auth = request.authorization
        valid = auth is not None and auth.type.lower() == 'basic'
        valid = valid and hmac.compare_digest((auth.username or '').encode(), username.encode())
        valid = valid and hmac.compare_digest((auth.password or '').encode(), password.encode())
        if not valid:
            return Response('Authentication required', 401, {'WWW-Authenticate': 'Basic realm="Fluixer", charset="UTF-8"'})
        supplied = request.headers.get('Origin')
        if supplied and supplied != origin:
            return jsonify(error='Request origin mismatch'), 403
        if request.method == 'POST':
            if supplied != origin or not request.is_json:
                return jsonify(error='Same-origin JSON requests are required'), 403

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.get('/healthz')
    def health():
        return jsonify(status='ok')

    @app.get('/')
    @app.get('/<path:asset>')
    def asset(asset=''):
        payload=asset_payload(asset)
        if payload is None:return jsonify(error='Page not found'),404
        return Response(payload.body,content_type=payload.content_type,headers=payload.headers)

    @app.route('/api/<operation>', methods=['GET', 'POST'])
    def api(operation):
        if operation not in OPERATIONS:
            return jsonify(error='Endpoint not found'), 404
        if request.method == 'GET':
            return jsonify(error='Use POST for this endpoint'), 405, {'Allow':'POST'}
        if not admission.acquire(blocking=False):
            response = jsonify(error='The server is busy. Please try again shortly.')
            response.headers['Retry-After'] = '1'
            return response, 503
        try:
            payload=dispatch(operation,request.get_json())
            return Response(payload.body,content_type=payload.content_type,headers=payload.headers)
        except (ValueError, TypeError, OverflowError) as error:
            return jsonify(error=str(error)), 400
        except HTTPException:
            raise
        except Exception:
            app.logger.exception('Calculation failed')
            return jsonify(error='Calculation failed. Try a simpler input or contact the administrator.'), 500
        finally:
            admission.release()

    return app
