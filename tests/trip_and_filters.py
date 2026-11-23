"""Exercise the map filters and trip planner with deterministic price and route data."""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright


url = sys.argv[1]
today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
history = {
    "6440": {today: {"unleaded": 3759, "premium": 4619}},
    "6540": {"2020-01-01": {"unleaded": 2749, "premium": 3489}},
}
directory = json.loads((Path(__file__).resolve().parents[1] / "dist" / "locations.json").read_text())
route_clubs = [club for club in directory if club["id"] in history]
coordinates = [[-76, 43], [-80, 35]]


def simulate_routing(route):
    request = route.request
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    }
    if request.method == "OPTIONS":
        route.fulfill(status=204, headers=headers)
        return
    if "/geocode/" in request.url:
        index = int("Destination" in request.url)
        feature = {"geometry": {"coordinates": coordinates[index]}, "properties": {"label": ["Start, US", "Destination, US"][index]}}
    else:
        points = request.post_data_json["coordinates"]
        extra = 0 if len(points) == 2 else (300 if points[1][0] == route_clubs[0]["longitude"] else 900)
        feature = {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": points},
            "properties": {"summary": {"duration": 3600 + extra, "distance": 100000 + extra * 10}},
        }
    route.fulfill(json={"features": [feature]}, headers=headers)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.route("**/prices.json", lambda route: route.fulfill(json=history))
    page.goto(url + "map.html")
    markers = page.locator(".fuel-price-pin")
    expect(markers).to_have_count(529)
    page.get_by_label("Fuel grade").select_option("premium")
    expect(page.locator(".price-legend")).to_contain_text("Premium price / gal")
    page.get_by_label("Maximum price per gallon").fill("4")
    expect(markers).to_have_count(1)
    expect(markers.first).to_have_attribute("title", route_clubs[1]["address"])
    page.get_by_label("Today’s prices only").check()
    expect(markers).to_have_count(0)
    page.get_by_label("Maximum price per gallon").fill("5")
    expect(markers).to_have_count(1)
    page.get_by_role("button", name="Clear filters").click()
    expect(markers).to_have_count(529)
    page.get_by_text("States and territories", exact=True).click()
    page.get_by_role("checkbox", name="NC", exact=True).check()
    nc_count = sum(club["publishedFuelPage"] and club["city"].endswith(", NC") for club in directory)
    expect(markers).to_have_count(nc_count)

    page.route("**/locations.json", lambda route: route.fulfill(json=route_clubs))
    page.route("https://api.openrouteservice.org/**", simulate_routing)
    page.goto(url + "trip.html")
    page.get_by_label("Start", exact=True).fill("Start")
    page.get_by_label("Destination", exact=True).fill("Destination")
    page.get_by_label("Openrouteservice API key").fill("test-key")
    page.get_by_role("button", name="Compare routes").click()
    expect(page.get_by_role("heading", name="Direct route")).to_be_visible()
    expect(page.get_by_role("heading", name="Via Sam’s Club")).to_be_visible()
    expect(page.locator("#trip-comparison")).to_contain_text("5 min extra")
    expect(page.locator("#trip-comparison")).to_contain_text(route_clubs[0]["address"])
    expect(page.get_by_role("link", name="View price history")).to_have_attribute("href", "./?club=6440")
    page.get_by_label("Maximum extra driving minutes").fill("2")
    page.get_by_role("button", name="Compare routes").click()
    expect(page.get_by_role("status")).to_contain_text("No checked stop fit the detour limit")
    expect(page.get_by_role("heading", name="Via Sam’s Club")).to_have_count(0)
    browser.close()
