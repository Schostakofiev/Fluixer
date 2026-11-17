# Fluixer 0.3.6

A design tool to simulate and export csv of Fluixel, an information visualisation method based on liquid segments.
https://fluixer-production.up.railway.app/

## Tests

Run Python checks with `python -B -m unittest discover -s tests -p "test_*.py"`.

For frontend checks, install test dependencies with `npm install`, then install the browser with `npx playwright install chromium`. Run `npm test`, or separately `npm run test:unit` and `npm run test:browser`.

Module tests import complete modules. Browser tests start a temporary local service on an automatically selected port and load the actual application, covering CSV, playback, serial synchronization, curve tools, history, project files, spatial brushes, and photo calibration. They neither cut functions from source files nor inject accessors into production code. The browser and service close after the run; no physical serial device is used.

Optional environment variables: `FLUIXER_TEST_PYTHON` selects a Python executable; `BROWSER_CHANNEL=msedge` uses installed Edge instead of Playwright Chromium. Website and STEP tests require the corresponding Python dependencies.
