# Sam’s Club Fuel Prices

Serve the buildless dashboard locally with Python 3.9 or later.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Visit http://127.0.0.1:8765. Search all 603 directory clubs by city, full state name, state abbreviation, or club number. Street address and ZIP search are available for the original two clubs.

The collector uses curl for HTTPS requests. In another terminal, run `python3 collect.py` for a one-time update or `python3 collect.py --watch` for local daily collection. Keep the watch process running on an awake machine with internet access. It checks at startup and each hour, checks each listed club’s fuel URL and skips locations already recorded that day. Requests run sequentially with a one-second delay. A 403 or 429 ends the current pass and saves any prices already gathered. Clubs without published prices have an empty chart until prices are collected. Dates use Eastern time. Reload the dashboard to see new observations.

The collector reads public Sam’s Club fuel pages and stores integer thousandths of a dollar in `dist/prices.json`. Missing days produce gaps. The opening snapshot was collected on November 21, 2026. The `dist` directory contains the static site for eventual GitHub Pages deployment.


## Refresh the directory

Download the official [directory](https://www.samsclub.com/club-directory), [club sitemap](https://www.samsclub.com/sitemap_locators.xml), and [services sitemap](https://www.samsclub.com/sitemap_hyperlocals.xml). Pass the three files to the importer in that order.

```sh
python3 import_directory.py directory.html sitemap_locators.xml sitemap_hyperlocals.xml
```

## GitHub Pages

The **Fuel prices and GitHub Pages** workflow publishes the dashboard from `dist` on pushes to `main`. It collects prices daily at 13:23 UTC, commits any new observations, and deploys the updated dashboard. Use **Run workflow** in the Actions tab to collect and deploy on demand.
