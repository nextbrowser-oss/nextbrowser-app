"""Minimal Browser Use DOM/action MCP adapter for an existing CDP browser."""

import asyncio
import json
import logging
import os
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


async def session() -> BrowserSession:
    global _session
    if _session is None:
        cdp_url = os.environ.get("NEXTBROWSER_CDP_URL", "").strip()
        if not cdp_url:
            raise RuntimeError("NEXTBROWSER_CDP_URL is required")
        _session = BrowserSession(cdp_url=cdp_url, keep_alive=True)
        await _session.start()
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


@mcp.tool()
async def browser_state(include_screenshot: bool = False) -> str:
    """Get the current semantic DOM. Use element indexes shown in semantic_dom for click/type."""
    async with _lock:
        return json.dumps(await state_payload(include_screenshot), ensure_ascii=False)


@mcp.tool()
async def browser_navigate(url: str, new_tab: bool = False) -> str:
    """Navigate the active tab to a URL, or open it in a new tab."""
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
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)


if __name__ == "__main__":
    asyncio.run(main())
