"""Import Sam's Club directory HTML and its two locator sitemaps."""
import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree

LOCATIONS = Path(__file__).resolve().parent / "dist" / "locations.json"
CLUB_URL = re.compile(r"(https://www\.samsclub\.com/club/(\d+)-[^/]+)(/fuel-center)?")


def find_directory(node):
    if isinstance(node, dict):
        if "storeDirectory" in node:
            yield json.loads(json.loads(node["storeDirectory"][0]["text"]))
        for value in node.values():
            yield from find_directory(value)
    elif isinstance(node, list):
        for value in node:
            yield from find_directory(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for source in ("directory", "locators", "services"):
        parser.add_argument(source, type=Path)
    args = parser.parse_args()
    script = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', args.directory.read_text(), re.S)
    states, = find_directory(json.loads(script[1]))
    clubs, fuel = {}, {}
    for sitemap in (args.locators, args.services):
        for element in ElementTree.parse(sitemap).iterfind(".//{*}loc"):
            match = CLUB_URL.fullmatch(element.text or "")
            if match:
                url, club, service = match.groups()
                clubs[club] = url
                if service:
                    fuel[club] = element.text

    previous = {entry["id"]: entry for entry in json.loads(LOCATIONS.read_text())}
    entries = {}
    for state, region in states.items():
        for city, listing in region["cities"].items():
            place = f"{city}, {state.upper()}"
            for number in listing["clubs"]:
                club = str(number)
                old = previous.get(club, {})
                club_url = clubs.get(club)
                if not club_url:
                    slug = re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")
                    club_url = f"https://www.samsclub.com/club/{club}-{slug}-{state}"
                entries[club] = {
                    "id": club, "city": place, "address": old.get("address", place),
                    "url": fuel.get(club, club_url + "/fuel-center"),
                    "clubUrl": club_url, "publishedFuelPage": club in fuel,
                    **{key: old[key] for key in ("latitude", "longitude") if key in old},
                }
    if not entries:
        raise ValueError("The official directory contained no club listings")
    ordered = sorted(entries.values(), key=lambda club: (
        club["id"] not in ("6440", "6540"), club["id"] != "6440", club["city"], club["id"],
    ))
    temporary = LOCATIONS.with_suffix(".tmp")
    temporary.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(LOCATIONS)
    print(f"{len(ordered)} clubs; {sum(c['publishedFuelPage'] for c in ordered)} published fuel pages; "
          f"{sum(c['id'] not in clubs for c in ordered)} club URLs inferred from the directory")


if __name__ == "__main__":
    main()
