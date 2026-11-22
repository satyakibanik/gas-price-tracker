"""Record the listed Sam's Club prices once per Eastern calendar day."""
import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

SITE = Path(__file__).resolve().parent / "dist"
HISTORY = SITE / "prices.json"
EASTERN = ZoneInfo("America/New_York")
PRICE = re.compile(
    r"\b(Unleaded|Premium|Diesel|Midgrade)\s+(\d+\.\d{2}) dollars and ([0-9]) tenths cents",
    re.IGNORECASE,
)


def collect(pages=None, checked=None, refresh=False):
    date = datetime.now(EASTERN).date().isoformat()
    history = json.loads(HISTORY.read_text()) if HISTORY.exists() else {}
    checked = checked if checked is not None else set()
    failed = False
    recorded = False
    checked.intersection_update({(day, club) for day, club in checked if day == date})
    for location in json.loads((SITE / "locations.json").read_text()):
        club = location["id"]
        days = history.get(club, {})
        if (date, club) in checked:
            continue
        if date in days and pages is None and not refresh:
            continue
        try:
            if pages is None:
                time.sleep(1)
                url = location["url"]
                response = subprocess.run(
                    ["curl", "--silent", "--show-error", "--location", "--max-time", "20",
                     "--write-out", "\n%{http_code}", url],
                    capture_output=True, check=True,
                )
                body, _, status = response.stdout.rpartition(b"\n")
                code = int(status)
                if code != 200:
                    raise HTTPError(url, code, "Fuel page response", None, None)
                html = body.decode("utf-8")
            else:
                slug = location["url"].split("/")[-2]
                saved_page = pages / f"fuel-{slug}.html"
                if not saved_page.exists():
                    continue
                html = saved_page.read_text()
            prices = {
                grade.lower(): int(dollars.replace(".", "") + fraction)
                for grade, dollars, fraction in PRICE.findall(html)
            }
            checked.add((date, club))
            if not prices:
                continue
            recorded = True
            history.setdefault(club, {})[date] = prices
            print(f"{date} {club} {prices}", flush=True)
        except HTTPError as error:
            checked.add((date, club))
            if error.code in (404, 410):
                continue
            print(f"{club}: HTTP {error.code}", file=sys.stderr, flush=True)
            failed = True
            if error.code in (403, 429):
                break
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            checked.add((date, club))
            print(f"{club}: {error}", file=sys.stderr, flush=True)
            failed = True
    temporary = HISTORY.with_suffix(".tmp")
    temporary.write_text(json.dumps(history, indent=2) + "\n")
    temporary.replace(HISTORY)
    if recorded:
        metadata = SITE / "price-update.json"
        temporary = metadata.with_suffix(".tmp")
        temporary.write_text(json.dumps({"updatedAt": datetime.now(EASTERN).isoformat(timespec="seconds")}) + "\n")
        temporary.replace(metadata)
    return failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--watch", action="store_true", help="Check for a new day every hour")
    options.add_argument("--pages", type=Path, help="Import official HTML saved today from this directory")
    parser.add_argument("--refresh", action="store_true", help="Refresh today’s recorded prices")
    args = parser.parse_args()
    checked = set()
    while True:
        failed = collect(args.pages, checked, refresh=args.refresh)
        if not args.watch:
            sys.exit(int(failed))
        time.sleep(3600)
