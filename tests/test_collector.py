"""Verify the collector against local fuel-page snapshots."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


class CollectorTest(unittest.TestCase):
    def test_import_preserves_history_and_ignores_pages_without_prices(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            site = directory / "dist"
            site.mkdir()
            shutil.copy(root / "collect.py", directory)
            shutil.copy(root / "dist" / "locations.json", site)
            history = site / "prices.json"
            previous = {"2020-01-01": {"unleaded": 1999}}
            history.write_text(json.dumps({"6440": previous}))
            (directory / "fuel-6440-latham-ny.html").write_text(
                "<span>Unleaded 3.75 dollars and 9 tenths cents</span>"
                "<span>Premium 4.61 dollars and 9 tenths cents</span>"
                "<span>Diesel 5.89 dollars and 9 tenths cents</span>"
            )
            (directory / "fuel-6540-charlotte-nc.html").write_text("<h1>Fuel center</h1>")
            command = [sys.executable, str(directory / "collect.py"), "--pages", str(directory)]
            subprocess.run(command, check=True, capture_output=True)
            date = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
            expected = {"6440": {**previous, date: {"unleaded": 3759, "premium": 4619, "diesel": 5899}}}
            self.assertEqual(json.loads(history.read_text()), expected)
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(json.loads(history.read_text()), expected)
