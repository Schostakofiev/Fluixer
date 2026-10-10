"""Authenticated website entry point. Local preview remains in webapp.py."""
import hmac
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, Response, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from . import __version__
from .compensation import curve_settings
from .pipeline import cylinder_settings
from .webapp import csv_payload, pattern_key, preview, _lock


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
        raise ValueError('Set FLUIXER_USERNAME and FLUIXER_PASSWORD (at least 16 characters)')

    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=4*1024*1024)
    admission = threading.BoundedSemaphore(1)
    ui = Path(__file__).parent / 'ui'

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
    def index():
        from html import escape
        return Response(ui.joinpath('index.html').read_text(encoding='utf-8').replace('{{VERSION}}', escape(__version__)), mimetype='text/html')

    @app.get('/<path:asset>')
    def asset(asset):
        allowed = asset in {'app.js', 'image-input.js', 'tube-renderer.js', 'style.css'}
        allowed = allowed or asset in {p.relative_to(ui).as_posix() for p in ui.glob('css/*.css')}
        allowed = allowed or asset in {p.relative_to(ui).as_posix() for p in ui.glob('fonts/open/*') if p.suffix in {'.ttf', '.txt'}}
        if not allowed:
            return jsonify(error='Page not found'), 404
        return send_from_directory(ui, asset)

    @app.route('/api/<operation>', methods=['GET', 'POST'])
    def api(operation):
        if operation not in {'display', 'export', 'image', 'step', 'tube-step', 'svg'}:
            return jsonify(error='Endpoint not found'), 404
        if request.method == 'GET' and operation != 'display':
            return jsonify(error='Use POST for this endpoint'), 405
        if not admission.acquire(blocking=False):
            response = jsonify(error='The server is busy. Please try again shortly.')
            response.headers['Retry-After'] = '1'
            return response, 503
        try:
            if request.method == 'GET':
                args = request.args
                data = {'calibration': args.get('calibration', 'original')}
                for field in ('cylinder', 'compensation'):
                    if field in args:
                        data[field] = json.loads(args[field])
                if args.get('pattern', 'captured-s') != 'captured-s':
                    data['pattern'] = {'type': args['pattern'], **{key: args.get(key, '') for key in ('width', 'height', 'x', 'z')}}
            else:
                data = request.get_json()
            if not isinstance(data, dict):
                raise ValueError('Request body must be a JSON object')
            if operation == 'export':
                with _lock:
                    body, name, rows = csv_payload(data)
                return Response(body, content_type='text/csv; charset=utf-8', headers={'Content-Disposition': f'attachment; filename="{name}"', 'X-Row-Count': str(rows)})
            if operation == 'display':
                if set(data) - {'calibration', 'pattern', 'compensation', 'cylinder', 'pre_add'}:
                    raise ValueError('Invalid preview parameters')
                cylinder = cylinder_settings(data.get('cylinder'))
                with _lock:
                    result = preview(data.get('calibration', 'compensated'), pattern_key(data.get('pattern'), cylinder), curve_settings(data.get('compensation')), cylinder)
                return jsonify(result)
            if set(data) != {'source'}:
                raise ValueError('Expected a source field')
            if operation == 'image':
                from .image_input import photo_subject
                return jsonify(photo_subject(data['source']))
            from .step_input import parse_step
            from .tube_step import parse_tube_step
            from .svg_input import parse_svg
            with _lock:
                return jsonify({'step': parse_step, 'tube-step': parse_tube_step, 'svg': parse_svg}[operation](data['source']))
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
