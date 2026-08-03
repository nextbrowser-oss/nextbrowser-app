from typing import Any


def require_green_verification(envelope: dict[str, Any], requested_country: str = "") -> dict[str, Any]:
    data = envelope.get("data") or {}
    verification = data.get("verify") or {}
    if verification.get("finalized") is not True:
        detail = verification.get("visible_text") or "verification did not finish"
        raise RuntimeError(f"Clawbrowser verification is not green: {detail}")
    if str(verification.get("status") or "").strip().lower() != "pass":
        raise RuntimeError(f"Clawbrowser verification failed with status {verification.get('status') or 'unknown'}")
    checks = verification.get("checks") or []
    if not checks:
        raise RuntimeError("Clawbrowser verification returned no checks")
    failed = [str(check.get("surface") or "unknown") for check in checks if check.get("pass") is not True]
    if failed:
        raise RuntimeError(f"Clawbrowser verification failed: {', '.join(failed)}")
    if requested_country:
        proxy = next((check for check in checks if str(check.get("surface") or "").lower() == "proxy"), None)
        if proxy is None:
            raise RuntimeError("Clawbrowser verification did not return a proxy check")
        actual = str(proxy.get("actual") or "").strip().upper()
        expected = str(proxy.get("expected") or "").strip().upper()
        if requested_country not in {actual[:2], expected[:2]}:
            raise RuntimeError(
                f"Clawbrowser proxy country mismatch: requested {requested_country}, "
                f"verify reported {actual or expected or 'unknown'}"
            )
    return verification
