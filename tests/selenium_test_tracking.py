#!/usr/bin/env python3
"""
Selenium smoke tests for Tracking Helper.

Serves the project root over HTTP (ES modules require a real origin), then drives Chrome.

Usage (recommended: venv so system Python stays clean):
  cd tracking_helper
  python3 -m venv .venv
  .venv/bin/pip install -r tests/requirements-selenium.txt
  .venv/bin/python tests/selenium_test_tracking.py
  .venv/bin/python tests/selenium_test_tracking.py --headed   # visible browser

Requires Chrome (Chromium). Selenium 4+ resolves the driver via Selenium Manager.
The script starts a local HTTP server (ES modules need http/https, not file://).
"""

from __future__ import annotations

import argparse
import http.server
import json
import socketserver
import sys
import threading
import time
import unittest
from datetime import date
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


class LocalStaticServer:
    """Serves PROJECT_ROOT at http://127.0.0.1:<port>/."""

    def __init__(self) -> None:
        self._httpd: socketserver.TCPServer | None = None
        self._thread: threading.Thread | None = None
        self.port: int = 0

    def start(self) -> str:
        self._httpd = socketserver.TCPServer(("127.0.0.1", 0), _QuietHandler)
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return f"http://127.0.0.1:{self.port}/"

    def stop(self) -> None:
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


def make_driver(headless: bool) -> webdriver.Chrome:
    opts = ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1280,900")
    return webdriver.Chrome(options=opts)


class TrackingHelperSeleniumTests(unittest.TestCase):
    server: LocalStaticServer
    base_url: str
    headless: bool = True

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = LocalStaticServer()
        cls.base_url = cls.server.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.stop()

    def setUp(self) -> None:
        self.driver = make_driver(headless=self.headless)
        self.wait = WebDriverWait(self.driver, 15)

    def tearDown(self) -> None:
        self.driver.quit()

    def _open_fresh(self) -> None:
        """Load app (new WebDriver profile → empty localStorage, consent pending)."""
        self.driver.get(self.base_url)

    def _accept_consent(self) -> None:
        self.wait.until(EC.element_to_be_clickable((By.ID, "consent-accept"))).click()
        self.wait.until(EC.invisibility_of_element_located((By.ID, "consent-overlay")))

    def _add_tracking_row(self) -> None:
        self.driver.find_element(By.ID, "btn-add-row").click()
        self.wait.until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, "#tracking-rows .track-row")
            )
        )

    def _first_row(self):
        return self.driver.find_element(By.CSS_SELECTOR, "#tracking-rows .track-row")

    def _load_with_preseeded_storage(self, data: dict) -> None:
        """Set consent + app JSON in localStorage, then reload (skips consent UI)."""
        self.driver.get(self.base_url)
        payload = json.dumps(data)
        self.driver.execute_script(
            """
            localStorage.setItem('tracking-helper-consent', 'accepted');
            localStorage.setItem('tracking-helper-v1', arguments[0]);
            """,
            payload,
        )
        self.driver.refresh()
        self.wait.until(EC.invisibility_of_element_located((By.ID, "consent-overlay")))

    def test_page_title_and_header(self) -> None:
        self._open_fresh()
        self.assertIn("Tracking Helper", self.driver.title)
        heading = self.driver.find_element(By.CSS_SELECTOR, ".app-header h1")
        self.assertEqual(heading.text.strip(), "Tracking Helper")

    def test_consent_accept_then_add_row_and_label(self) -> None:
        self._open_fresh()
        self.wait.until(
            EC.visibility_of_element_located((By.ID, "consent-title")),
            "Consent dialog should show on first visit",
        )
        self._accept_consent()
        self._add_tracking_row()
        label_inp = self._first_row().find_element(By.CSS_SELECTOR, ".track-label")
        label_inp.send_keys("TICK-SEL-001")
        self.driver.execute_script("arguments[0].blur()", label_inp)
        self.driver.find_element(By.ID, "btn-add-row").click()
        self.wait.until(
            lambda d: "TICK-SEL-001"
            in d.find_element(By.ID, "tracking-rows").text
        )

    def test_timer_start_pause_updates_hours_field(self) -> None:
        """Short intervals round to 0 h in the hours field (one decimal)."""
        self._open_fresh()
        self._accept_consent()
        self._add_tracking_row()
        row = self._first_row()
        row.find_element(By.CSS_SELECTOR, ".track-label").send_keys("TICK-TIMER")
        row.find_element(By.CSS_SELECTOR, ".btn-primary").click()

        def pause_enabled(driver):
            r = driver.find_element(By.CSS_SELECTOR, "#tracking-rows .track-row")
            return r.find_element(By.XPATH, ".//button[text()='Pause']").is_enabled()

        self.wait.until(pause_enabled)
        time.sleep(2.2)
        self.driver.find_element(
            By.XPATH, "//div[contains(@class,'track-row')]//button[text()='Pause']"
        ).click()
        hours_inp = self.driver.find_element(By.CSS_SELECTOR, ".track-hours")
        val = float((hours_inp.get_attribute("value") or "0").strip())
        self.assertAlmostEqual(val, 0.0, places=1)

    def test_preseeded_hour_shows_nonzero_decimal_hours(self) -> None:
        day = date.today().isoformat()
        tid = "seed-topic-id"
        self._load_with_preseeded_storage(
            {
                "rowsByDay": {
                    day: [
                        {
                            "id": tid,
                            "label": "TICK-ONE-HOUR",
                            "seconds": 3600,
                        }
                    ]
                },
                "activeTimer": None,
            }
        )
        self.wait.until(
            lambda d: "TICK-ONE-HOUR"
            in d.find_element(By.ID, "tracking-rows").text
        )
        hours_inp = self.driver.find_element(By.CSS_SELECTOR, ".track-hours")
        val = float((hours_inp.get_attribute("value") or "0").strip())
        self.assertAlmostEqual(val, 1.0, places=1)

    def test_charts_canvas_shown_after_logging_time(self) -> None:
        self._open_fresh()
        self._accept_consent()
        self._add_tracking_row()
        row = self._first_row()
        row.find_element(By.CSS_SELECTOR, ".track-label").send_keys("TICK-CHART")
        row.find_element(By.CSS_SELECTOR, ".btn-primary").click()
        time.sleep(1.5)
        row.find_element(By.XPATH, ".//button[text()='Pause']").click()
        self.wait.until(
            lambda d: d.find_element(By.ID, "chart-vs8").value_of_css_property("display")
            != "none"
        )
        self.wait.until(
            lambda d: d.find_element(By.ID, "chart-scaled").value_of_css_property("display")
            != "none"
        )

    def test_decline_consent_allows_session_use(self) -> None:
        self._open_fresh()
        self.wait.until(EC.element_to_be_clickable((By.ID, "consent-decline"))).click()
        self.wait.until(EC.invisibility_of_element_located((By.ID, "consent-overlay")))
        self._add_tracking_row()
        self._first_row().find_element(By.CSS_SELECTOR, ".track-label").send_keys(
            "TICK-DECLINE"
        )
        self.wait.until(
            lambda d: "TICK-DECLINE" in d.find_element(By.ID, "tracking-rows").text
        )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Selenium tests for Tracking Helper")
    p.add_argument(
        "--headed",
        action="store_true",
        help="Show browser window (default: headless)",
    )
    p.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose unittest output",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    TrackingHelperSeleniumTests.headless = not args.headed
    loader = unittest.defaultTestLoader.loadTestsFromTestCase(TrackingHelperSeleniumTests)
    runner = unittest.TextTestRunner(verbosity=2 if args.verbose else 1)
    result = runner.run(loader)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
