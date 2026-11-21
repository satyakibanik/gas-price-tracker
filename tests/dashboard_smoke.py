"""Check the public dashboard through Chromium."""
import sys

from playwright.sync_api import expect, sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto(sys.argv[1])
    expect(page.locator("#location")).to_have_text("Latham, NY")
    search = page.get_by_role("searchbox", name="Find a fuel center")
    search.fill("North Carolina")
    results = page.locator("#results")
    expect(results.get_by_role("button", name="Charlotte, NC · #6540", exact=False)).to_be_visible()
    expect(results.get_by_role("button", name="Matthews, NC", exact=False)).to_be_visible()
    results.get_by_role("button", name="Charlotte, NC · #6540", exact=False).click()
    expect(page.locator("#location")).to_have_text("Charlotte, NC")
    expect(page.locator("#address")).to_contain_text("JW Clay Blvd")
    chart = page.locator("#chart")
    expect(chart).to_be_visible()
    chart.locator("circle").first.hover()
    tooltip = page.locator("#price-tooltip")
    expect(tooltip).to_be_visible()
    expect(tooltip).to_contain_text("Unleaded $")
    expect(tooltip).to_contain_text("Premium $")
    expect(tooltip).to_contain_text("Diesel $")
    search.hover()
    expect(tooltip).to_be_hidden()
    search.fill("no-such-club-00000")
    expect(results).to_contain_text("No matching fuel centers.")
    browser.close()
