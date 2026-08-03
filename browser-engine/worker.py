"""Minimal Browser Use DOM/action MCP adapter for an existing CDP browser."""

import asyncio
import json
import logging
import os
import re
import sys
from typing import Any, Literal

VERSION = "0.1.0"
if "--version" in sys.argv:
    print(VERSION)
    raise SystemExit(0)

os.environ.setdefault("BROWSER_USE_LOGGING_LEVEL", "critical")
os.environ.setdefault("BROWSER_USE_SETUP_LOGGING", "false")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
logging.disable(logging.CRITICAL)

from browser_use.browser import BrowserSession
from browser_use.browser.events import (
    ClickCoordinateEvent,
    ClickElementEvent,
    CloseTabEvent,
    GoBackEvent,
    NavigateToUrlEvent,
    ScreenshotEvent,
    ScrollEvent,
    SwitchTabEvent,
    TypeTextEvent,
)
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("nextbrowser-browser-engine", log_level="ERROR")
_session: BrowserSession | None = None
_lock = asyncio.Lock()
_cdp_url = os.environ.get("NEXTBROWSER_CDP_URL", "").strip()


async def session() -> BrowserSession:
    global _session
    if _session is None:
        if not _cdp_url:
            raise RuntimeError("NEXTBROWSER_CDP_URL is required")
        _session = BrowserSession(cdp_url=_cdp_url, keep_alive=True)
        await _session.start()
        await sync_nextctl_active_tab(_session)
    return _session


async def dispatch(event: Any) -> Any:
    current = await session()
    emitted = current.event_bus.dispatch(event)
    return await emitted.event_result(raise_if_none=False, raise_if_any=True)


async def state_payload(include_screenshot: bool = False) -> dict[str, Any]:
    current = await session()
    state = await current.get_browser_state_summary(include_screenshot=include_screenshot)
    tabs = await current.get_tabs()
    dom = state.dom_state
    return {
        "engine": "browser-use-dom",
        "url": state.url,
        "title": state.title,
        "semantic_dom": dom.llm_representation() if dom else "",
        "interactive_element_count": len(dom.selector_map) if dom else 0,
        "tabs": [
            {"index": index, "target_id": str(tab.target_id), "url": tab.url, "title": tab.title}
            for index, tab in enumerate(tabs)
        ],
        "screenshot_base64": state.screenshot if include_screenshot else None,
    }


async def run_nextctl(args: list[str]) -> dict[str, Any]:
    binary = os.environ.get("NEXTBROWSER_NEXTCTL_BIN", "").strip()
    if not binary:
        raise RuntimeError("nextctl is unavailable in this engine session")
    process = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("nextctl timed out while preparing the proxy session")
    output = stdout.decode("utf-8", errors="replace").strip()
    try:
        envelope = json.loads(output)
    except json.JSONDecodeError:
        detail = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or "nextctl returned no valid preparation result")
    if process.returncode != 0 or not envelope.get("ok"):
        error = envelope.get("error") or {}
        raise RuntimeError(error.get("message") or "nextctl could not prepare the browser session")
    return envelope


async def sync_nextctl_active_tab(current: BrowserSession) -> None:
    """Keep Browser Use attached to the tab selected by nextctl/Clawbrowser."""
    if not _cdp_url or not os.environ.get("NEXTBROWSER_NEXTCTL_BIN", "").strip():
        return
    try:
        envelope = await run_nextctl(["--cdp", _cdp_url, "tabs", "list", "--format", "json"])
        tabs = (envelope.get("data") or {}).get("tabs") or []
        selected = next((tab for tab in tabs if tab.get("active") or tab.get("current")), None)
        target_id = str((selected or {}).get("id") or "")
        if not target_id:
            return
        browser_tabs = await current.get_tabs()
        if any(str(tab.target_id) == target_id for tab in browser_tabs):
            emitted = current.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
            await emitted.event_result(raise_if_none=False, raise_if_any=True)
    except Exception:
        # Attaching must still work with old nextctl builds or explicit raw CDP URLs.
        return


@mcp.tool()
async def browser_prepare(
    country: str | None = None,
    url: str | None = None,
    profile: str | None = None,
) -> str:
    """Prepare the browser identity before browsing. MUST be the first browser tool called when the user requests a proxy, country, or identity. Country is a two-letter ISO code such as US. Returns only after nextctl has started/rotated and verified the proxy session."""
    global _cdp_url, _session
    async with _lock:
        requested_country = (country or "").strip().upper()
        if requested_country and not re.fullmatch(r"[A-Z]{2}", requested_country):
            raise ValueError("country must be a two-letter ISO code such as US")
        selected_profile = (profile or os.environ.get("NEXTBROWSER_PROFILE", "")).strip()
        if selected_profile and not re.fullmatch(r"[A-Za-z0-9._-]+", selected_profile):
            raise ValueError("profile contains unsupported characters")
        if url and not re.match(r"^https?://", url, re.IGNORECASE):
            raise ValueError("url must use http or https")

        args: list[str] = []
        if selected_profile:
            args.extend(["--profile", selected_profile])
        args.append("rotate" if requested_country else "start")
        if requested_country:
            args.extend(["--country", requested_country, "--proxy-scheme", "http", "--verify"])
        if url:
            args.extend(["--url", url])
        args.extend(["--format", "json"])
        envelope = await run_nextctl(args)
        data = envelope.get("data") or {}
        endpoint = (data.get("session") or {}).get("endpoint") or data.get("endpoint")
        if not endpoint:
            raise RuntimeError("nextctl prepared the session but returned no CDP endpoint")

        old_session = _session
        _session = None
        _cdp_url = str(endpoint)
        if old_session is not None:
            try:
                await old_session.event_bus.stop(clear=True, timeout=2)
            except Exception:
                pass
        await session()
        return json.dumps({
            "prepared": True,
            "verified": bool(requested_country),
            "country": requested_country or None,
            "profile": selected_profile or "default",
            "endpoint": _cdp_url,
            "next_step": "Use browser_state or browser_navigate only after this success response.",
        }, ensure_ascii=False)


@mcp.tool()
async def browser_state(include_screenshot: bool = False) -> str:
    """Get the current semantic DOM. Use element indexes shown in semantic_dom for click/type."""
    async with _lock:
        return json.dumps(await state_payload(include_screenshot), ensure_ascii=False)


@mcp.tool()
async def browser_navigate(url: str, new_tab: bool = False) -> str:
    """Navigate the active tab to a URL, or open it in a new tab. If the request specified a proxy/country/identity, call browser_prepare first."""
    async with _lock:
        await dispatch(NavigateToUrlEvent(url=url, new_tab=new_tab, wait_until="domcontentloaded"))
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_click(index: int | None = None, x: int | None = None, y: int | None = None) -> str:
    """Click an element by semantic DOM index, or by x/y coordinates."""
    async with _lock:
        current = await session()
        if index is not None:
            state = await current.get_browser_state_summary(include_screenshot=False)
            node = state.dom_state.selector_map.get(index) if state.dom_state else None
            if node is None:
                raise ValueError(f"Element index {index} is not present in the current DOM; call browser_state again")
            await dispatch(ClickElementEvent(node=node))
        elif x is not None and y is not None:
            await dispatch(ClickCoordinateEvent(coordinate_x=x, coordinate_y=y))
        else:
            raise ValueError("Provide index, or both x and y")
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_type(index: int, text: str, clear: bool = True) -> str:
    """Type into an element from the latest semantic DOM by index."""
    async with _lock:
        current = await session()
        state = await current.get_browser_state_summary(include_screenshot=False)
        node = state.dom_state.selector_map.get(index) if state.dom_state else None
        if node is None:
            raise ValueError(f"Element index {index} is not present in the current DOM; call browser_state again")
        await dispatch(TypeTextEvent(node=node, text=text, clear=clear))
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_scroll(direction: Literal["up", "down", "left", "right"] = "down", amount: int = 600) -> str:
    """Scroll the active page by pixels."""
    async with _lock:
        await dispatch(ScrollEvent(direction=direction, amount=amount))
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_back() -> str:
    """Go back in the active tab history."""
    async with _lock:
        await dispatch(GoBackEvent())
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_html() -> str:
    """Return the current page HTML for extraction when semantic DOM is insufficient."""
    async with _lock:
        current = await session()
        cdp = await current.get_or_create_cdp_session()
        result = await cdp.cdp_client.send.Runtime.evaluate(
            params={"expression": "document.documentElement.outerHTML", "returnByValue": True},
            session_id=cdp.session_id,
        )
        return str(result.get("result", {}).get("value", ""))


@mcp.tool()
async def browser_evaluate(expression: str) -> str:
    """Evaluate JavaScript in the active page and return a JSON-serializable result."""
    async with _lock:
        current = await session()
        cdp = await current.get_or_create_cdp_session()
        result = await cdp.cdp_client.send.Runtime.evaluate(
            params={"expression": expression, "returnByValue": True, "awaitPromise": True},
            session_id=cdp.session_id,
        )
        if result.get("exceptionDetails"):
            raise RuntimeError(str(result["exceptionDetails"]))
        return json.dumps(result.get("result", {}).get("value"), ensure_ascii=False)


@mcp.tool()
async def browser_screenshot(full_page: bool = False) -> str:
    """Return a base64 PNG screenshot of the active page."""
    async with _lock:
        return str(await dispatch(ScreenshotEvent(full_page=full_page)))


@mcp.tool()
async def browser_tabs() -> str:
    """List browser tabs and their stable target IDs."""
    async with _lock:
        current = await session()
        tabs = await current.get_tabs()
        return json.dumps([
            {"index": index, "target_id": str(tab.target_id), "url": tab.url, "title": tab.title}
            for index, tab in enumerate(tabs)
        ], ensure_ascii=False)


@mcp.tool()
async def browser_switch_tab(target_id: str) -> str:
    """Switch to a tab by target_id from browser_tabs."""
    async with _lock:
        await dispatch(SwitchTabEvent(target_id=target_id))
        return json.dumps(await state_payload(), ensure_ascii=False)


@mcp.tool()
async def browser_close_tab(target_id: str) -> str:
    """Close a tab by target_id from browser_tabs."""
    async with _lock:
        await dispatch(CloseTabEvent(target_id=target_id))
        return json.dumps(await state_payload(), ensure_ascii=False)


async def main() -> None:
    # The CDP browser is owned by nextctl. When stdio closes, let process exit
    # tear down this adapter's tasks; BrowserSession.kill()/stop() could close
    # the user's shared browser or race with MCP's already-closed stdio.
    await mcp.run_stdio_async()
    # Browser Use keeps background watchdog tasks for a live session. This
    # sidecar owns neither the browser nor reusable state, so EOF is a terminal
    # condition and a direct process exit avoids hanging while those tasks wait.
    os._exit(0)


if __name__ == "__main__":
    asyncio.run(main())
