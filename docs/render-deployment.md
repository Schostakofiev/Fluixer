# Render deployment: invited preview

This source is prepared for deployment; no website has been published yet.

## Dashboard setup

1. Render: New > Web Service > connect Schostakofiev/Fluixer.
2. Language: Docker. Root Directory: blank. Dockerfile Path: ./Dockerfile.
3. Choose a region close to your users. A 2 GB RAM instance is an initial estimate;
   actual memory and concurrent use must be measured. Review pricing before paying.
4. Health Check Path: /healthz.
5. Set FLUIXER_USERNAME and FLUIXER_PASSWORD in Render environment variables.
   Use a unique random password of at least 16 characters. Never commit credentials.
6. Deploy and open the assigned HTTPS URL. Enter the credentials in the browser prompt.

Render supplies PORT and RENDER_EXTERNAL_URL. If using a custom domain, set
FLUIXER_ORIGIN to its exact HTTPS origin, with no path. Use only HTTPS for visitors.

All pages and APIs require HTTP Basic authentication. /healthz exposes only an ok
status. This is a shared invited-preview account, not individual user management.
Rotate the password and redeploy to revoke shared access. Browsers can retain
credentials until closed. A public repository does not remove the website password.

## Data and computation

Uploads are processed on the server. STEP temporary files are deleted after
parsing. Parsed geometry and previews may remain in bounded in-memory caches
until eviction or server restart. Projects and CSV files download to the browser;
there is no cloud project database.

One worker with four request threads admits one expensive API request at a time.
Other clients receive a busy response and can retry. Do not raise worker/replica
counts without reviewing capacity and admission limits. The Gunicorn timeout is
not a hard per-calculation CPU deadline. This setup is for invited previews, not
anonymous public access with job isolation.

## Verification

Install requirements-web.txt, then run:
python -m unittest discover -s tests -p test_website.py

Where Docker is available:
docker build -t fluixer:0.2.0-web .

After deployment, verify authentication for / and /api/display, S/Cylinder/Hilbert,
STEP pattern and tube imports, image recognition, spatial brush, project reload,
and CSV agreement with local 0.2.0. Measure memory usage and two-client behavior.
Linux Docker build and Render smoke checks are still required before launch.

The container installs Linux libraries and copies only the model from vendor.
Windows runtime binaries, user projects, original GH files and backups must not
be uploaded. Preserve bundled font and model licenses.

References:
https://render.com/docs/docker
https://render.com/docs/web-services
https://flask.palletsprojects.com/en/stable/deploying/gunicorn/
