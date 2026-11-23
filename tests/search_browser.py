"""Verify club search with mouse, keyboard, and mobile taps."""
import sys

from playwright.sync_api import expect, sync_playwright


url, engine = sys.argv[1:]
devices = {"chromium": "Pixel 7", "webkit": "iPhone 13"}

with sync_playwright() as playwright:
    browser = getattr(playwright, engine).launch()
    desktop = browser.new_page()
    desktop.goto(url)
    search = desktop.get_by_role("searchbox", name="Find a fuel center")
    search.fill("North Carolina")
    search.press("Enter")
    expect(desktop.locator("#location")).to_have_text("Charlotte, NC")
    search.fill("6440")
    desktop.get_by_role("button", name="Latham, NY · #6440", exact=False).click()
    expect(desktop.locator("#location")).to_have_text("Latham, NY")

    if engine in devices:
        phone = browser.new_page(**playwright.devices[devices[engine]])
        phone.goto(url)
        search = phone.get_by_role("searchbox", name="Find a fuel center")
        search.tap()
        search.fill("North Carolina")
        result = phone.get_by_role("button", name="Charlotte, NC · #6540", exact=False)
        expect(result).to_be_visible()
        # A touch browser can blur the input without giving the button focus.
        search.blur()
        result.tap()
        expect(phone.locator("#location")).to_have_text("Charlotte, NC")
        expect(phone.locator("#chart")).to_be_visible()
        expect(phone.locator("#results")).to_be_hidden()
    browser.close()
