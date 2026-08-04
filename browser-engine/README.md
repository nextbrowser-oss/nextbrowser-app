# Experimental browser engine

This packaged MCP component exposes Browser Use's browser session, semantic DOM,
and action primitives against an existing Clawbrowser CDP endpoint. It does not
include Browser Use's Agent, prompts, LLM integrations, browser launcher, or
cloud service. NextBrowser's selected agent remains the planner and `nextctl`
remains responsible for profiles, proxy identity, CAPTCHA handling, and browser
lifecycle.

The component is optional and currently supported for Codex and Claude Code.
Build it with `python scripts/build-browser-engine.py` before packaging the app.
