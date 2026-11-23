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
coordinates = [[-73.75, 42.75], [-80.84, 35.23]]
corridor_points = [[club["longitude"], club["latitude"]] for club in route_clubs]
off_route = next(club for club in directory if club["publishedFuelPage"] and club["city"].endswith(", CA"))


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
            "geometry": {"type": "LineString", "coordinates": [points[0], *(corridor_points if points[0] == coordinates[0] else corridor_points[::-1]), points[-1]] if len(points) == 2 else points},
            "properties": {"summary": {"duration": 3600 + extra, "distance": 100000 + extra * 10}},
        }
    route.fulfill(json={"features": [feature]}, headers=headers)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async text => { window.copiedFuelStops = text; } }
    });""")
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
    expect(page.get_by_role("status")).to_have_text("No fuel centers match the selected filters.")
    page.get_by_label("Maximum price per gallon").fill("5")
    expect(markers).to_have_count(1)
    page.get_by_role("button", name="Clear filters").click()
    expect(markers).to_have_count(529)
    page.get_by_text("States and territories", exact=True).click()
    names = page.locator("#map-states label").all_text_contents()
    assert names == sorted(names, key=str.casefold)
    page.get_by_role("checkbox", name="North Carolina", exact=True).check()
    nc_count = sum(club["publishedFuelPage"] and club["city"].endswith(", NC") for club in directory)
    expect(markers).to_have_count(nc_count)

    page.route("**/locations.json", lambda route: route.fulfill(json=[*route_clubs, off_route]))
    page.route("https://api.openrouteservice.org/**", simulate_routing)
    page.goto(url + "trip.html")
    detour = page.get_by_label("Maximum extra driving minutes")
    expect(detour).to_have_value("60")
    detour.fill("10")
    page.get_by_label("Start", exact=True).fill("Start")
    page.get_by_label("Destination", exact=True).fill("Destination")
    page.get_by_label("Openrouteservice API key").fill("test-key")
    page.get_by_role("button", name="Compare routes").click()
    expect(page.get_by_role("heading", name="Direct route")).to_be_visible()
    expect(page.get_by_role("heading", name="Via Sam’s Club")).to_be_visible()
    expect(page.locator("#trip-comparison")).to_contain_text("5 min extra")
    expect(page.locator("#trip-comparison")).to_contain_text(route_clubs[0]["address"])
    expect(page.get_by_role("link", name="View price history")).to_have_attribute("href", "./?club=6440")
    expect(page.locator("#trip-map .trip-station")).to_have_count(2)
    page.get_by_role("button", name="Copy fuel stops").click()
    expect(page.locator("#copy-status")).to_have_text("Fuel stops copied.")
    copied = page.evaluate("window.copiedFuelStops")
    stops = [row for row in copied.splitlines() if "mi — Sam’s Club" in row]
    assert len(stops) == 2
    assert "Sam’s Club #6440" in stops[0] and route_clubs[0]["address"] in stops[0] and "$3.759/gal" in stops[0]
    assert "Sam’s Club #6540" in stops[1] and "$2.749/gal" in stops[1]
    distances = [float(row.split()[0]) for row in stops]
    assert distances[0] < distances[1]
    expect(page.locator("#trip-map .trip-stop")).to_have_attribute("title", route_clubs[0]["address"])
    route_overlay = page.locator("#trip-map .leaflet-overlay-pane svg")
    expect(route_overlay.locator("path")).to_have_count(2)
    # Leaflet sizes the SVG viewport to match its projected route geometry.
    assert route_overlay.evaluate("""svg => {
        const box = svg.getBoundingClientRect();
        return Math.abs(box.width - Number(svg.getAttribute('width'))) < 1 &&
               Math.abs(box.height - Number(svg.getAttribute('height'))) < 1;
    }""")
    expect(page.locator("#trip-map .price-legend")).to_contain_text("Unleaded price / gal")
    colors = page.locator("#trip-map .trip-station").evaluate_all(
        "(pins) => pins.map(pin => pin.style.backgroundColor)"
    )
    assert len(set(colors)) == 2
    station = page.locator("#trip-map .trip-station:not(.trip-stop)")
    station.dispatch_event("click")
    expect(page.locator("#trip-map .leaflet-popup")).to_contain_text("Unleaded $2.749/gal")
    expect(page.get_by_label("Openrouteservice API key")).to_have_value("")
    page.get_by_label("Openrouteservice API key").fill("test-key")
    page.get_by_label("Maximum extra driving minutes").fill("2")
    page.get_by_role("button", name="Compare routes").click()
    expect(page.get_by_role("status")).to_contain_text("No checked stop fit the detour limit")
    expect(page.get_by_role("heading", name="Via Sam’s Club")).to_have_count(0)
    expect(page.locator("#trip-map .trip-station")).to_have_count(2)
    expect(page.locator("#trip-map .leaflet-overlay-pane path")).to_have_count(1)
    page.get_by_role("button", name="Add leg").click()
    second_leg = page.get_by_role("group", name="Leg 2")
    expect(second_leg.get_by_label("Start", exact=True)).to_have_value("Destination")
    second_leg.get_by_label("Destination").fill("Start")
    page.get_by_label("Openrouteservice API key").fill("test-key")
    page.get_by_role("button", name="Compare routes").click()
    expect(page.locator("#trip-status")).to_contain_text("Compared 2 of 2 legs")
    expect(page.get_by_role("heading", name="Direct route")).to_have_count(2)
    expect(page.get_by_text("Fuel stations (2)", exact=True)).to_have_count(2)
    expect(page.locator("#trip-map .trip-station")).to_have_count(2)
    route_colors = page.locator("#trip-map .leaflet-overlay-pane path").evaluate_all(
        "(paths) => paths.map(path => path.getAttribute('stroke'))"
    )
    assert len(set(route_colors)) == 2
    control = page.locator("#trip-map .leaflet-control-layers")
    control.locator(".leaflet-control-layers-toggle").hover()
    first_layer = control.locator("label").filter(has_text="Leg 1 · Start, US → Destination, US").get_by_role("checkbox")
    second_layer = control.locator("label").filter(has_text="Leg 2 · Destination, US → Start, US").get_by_role("checkbox")
    expect(first_layer).to_be_checked()
    expect(second_layer).to_be_checked()
    assert first_layer.bounding_box()["width"] <= 16
    first_layer.uncheck()
    expect(page.locator("#trip-map .leaflet-overlay-pane path")).to_have_count(1)
    first_layer.check()
    page.get_by_role("button", name="Copy fuel stops").click()
    expect(page.locator("#copy-status")).to_have_text("Fuel stops copied.")
    copied = page.evaluate("window.copiedFuelStops")
    outward, return_trip = copied.split("Leg 2 · ")
    assert "Leg 1 · " in outward
    assert outward.index("#6440") < outward.index("#6540")
    assert return_trip.index("#6540") < return_trip.index("#6440")
    assert copied.count("mi — Sam’s Club") == 4
    browser.close()
