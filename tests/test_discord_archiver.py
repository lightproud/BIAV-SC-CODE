import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

# Import-time side effects are limited to logging.basicConfig (no env reads,
# no network), so the module can be imported directly.
from discord_archiver import (
    DISCORD_EPOCH_MS,
    _dt_from_sf,
    _mstr,
    _month_bounds,
    _prev_month,
    _sf_from_dt,
)


class TestSnowflakeHelpers(unittest.TestCase):
    def test_discord_epoch_constant(self):
        # 2015-01-01T00:00:00Z in milliseconds — the documented Discord epoch.
        epoch = datetime(2015, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(DISCORD_EPOCH_MS, int(epoch.timestamp() * 1000))

    def test_epoch_maps_to_snowflake_zero(self):
        epoch = datetime(2015, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(_sf_from_dt(epoch), "0")

    def test_snowflake_zero_maps_to_epoch(self):
        self.assertEqual(_dt_from_sf("0"), datetime(2015, 1, 1, tzinfo=timezone.utc))

    def test_pre_epoch_datetime_clamps_to_zero(self):
        # Datetimes before the Discord epoch must not produce negative snowflakes.
        self.assertEqual(_sf_from_dt(datetime(2014, 6, 1, tzinfo=timezone.utc)), "0")

    def test_round_trip_millisecond_precision(self):
        # dt -> snowflake -> dt is exact for millisecond-precision datetimes.
        dt = datetime(2023, 7, 15, 12, 34, 56, 789000, tzinfo=timezone.utc)
        self.assertEqual(_dt_from_sf(_sf_from_dt(dt)), dt)

    def test_round_trip_accepts_int_snowflake(self):
        dt = datetime(2026, 6, 10, tzinfo=timezone.utc)
        self.assertEqual(_dt_from_sf(int(_sf_from_dt(dt))), dt)

    def test_snowflake_low_22_bits_are_worker_bits(self):
        # Worker/process/increment bits below bit 22 must not change the timestamp.
        dt = datetime(2024, 1, 1, tzinfo=timezone.utc)
        sf = int(_sf_from_dt(dt))
        self.assertEqual(_dt_from_sf(sf + (1 << 22) - 1), dt)


class TestMonthBounds(unittest.TestCase):
    def test_regular_month(self):
        after_sf, before_sf = _month_bounds(2026, 3)
        self.assertEqual(_dt_from_sf(after_sf), datetime(2026, 3, 1, tzinfo=timezone.utc))
        self.assertEqual(_dt_from_sf(before_sf), datetime(2026, 4, 1, tzinfo=timezone.utc))

    def test_december_rolls_over_to_next_year(self):
        after_sf, before_sf = _month_bounds(2025, 12)
        self.assertEqual(_dt_from_sf(after_sf), datetime(2025, 12, 1, tzinfo=timezone.utc))
        self.assertEqual(_dt_from_sf(before_sf), datetime(2026, 1, 1, tzinfo=timezone.utc))

    def test_leap_year_february_spans_29_days(self):
        after_sf, before_sf = _month_bounds(2024, 2)
        span = _dt_from_sf(before_sf) - _dt_from_sf(after_sf)
        self.assertEqual(span.days, 29)

    def test_non_leap_february_spans_28_days(self):
        after_sf, before_sf = _month_bounds(2023, 2)
        span = _dt_from_sf(before_sf) - _dt_from_sf(after_sf)
        self.assertEqual(span.days, 28)

    def test_bounds_are_strings_and_ordered(self):
        after_sf, before_sf = _month_bounds(2026, 6)
        self.assertIsInstance(after_sf, str)
        self.assertIsInstance(before_sf, str)
        self.assertLess(int(after_sf), int(before_sf))


class TestPrevMonth(unittest.TestCase):
    def test_mid_year(self):
        self.assertEqual(_prev_month(2026, 6), (2026, 5))

    def test_january_rolls_back_to_previous_december(self):
        self.assertEqual(_prev_month(2026, 1), (2025, 12))

    def test_december_stays_in_same_year(self):
        self.assertEqual(_prev_month(2026, 12), (2026, 11))


class TestMstr(unittest.TestCase):
    def test_zero_pads_month(self):
        self.assertEqual(_mstr(2026, 3), "2026-03")

    def test_two_digit_month_unpadded(self):
        self.assertEqual(_mstr(2025, 12), "2025-12")

    def test_zero_pads_year_to_four_digits(self):
        self.assertEqual(_mstr(999, 7), "0999-07")


if __name__ == "__main__":
    unittest.main()
