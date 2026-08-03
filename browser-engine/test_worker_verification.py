from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from verification import require_green_verification


class VerificationContractTests(unittest.TestCase):
    def test_accepts_green_requested_country(self):
        result = require_green_verification({"data": {"verify": {
            "finalized": True, "status": "pass",
            "checks": [{"surface": "proxy", "pass": True, "expected": "US", "actual": "US (New York)"}],
        }}}, "US")
        self.assertEqual(result["status"], "pass")

    def test_rejects_pending_failed_or_wrong_country(self):
        cases = [
            {"finalized": False, "visible_text": "Running checks"},
            {"finalized": True, "status": "fail", "checks": [{"surface": "proxy", "pass": False}]},
            {"finalized": True, "status": "pass", "checks": [{"surface": "proxy", "pass": True, "actual": "DE"}]},
        ]
        for verification in cases:
            with self.subTest(verification=verification), self.assertRaises(RuntimeError):
                require_green_verification({"data": {"verify": verification}}, "US")


if __name__ == "__main__":
    unittest.main()
