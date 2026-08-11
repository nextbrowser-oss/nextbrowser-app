---
name: makler-car-search
description: Search and extract relevant vehicle listings from makler.md with proxy verification, pagination, filtering, and canonical URL deduplication.
---

# Makler car search

Use Clawbrowser to find vehicle listings on `makler.md` and return complete, relevant results.

## Workflow

1. Choose one descriptive profile name and start or reattach it. If the user requests a proxy country, pass the country during profile start and confirm verification succeeded before interacting with Makler. Do not repeatedly start an already verified profile.
2. Open `https://makler.md` and resolve the vehicle search from the current page by role, label, visible text, or a stable selector. Treat captured `element_id` values as valid only for the current page state.
3. Search for the requested make and model. Apply requested year, price, location, mileage, fuel, transmission, or other filters through the site's controls when available.
4. Confirm the resulting page and active filters reflect the request before extraction. Wait for navigation or page settlement only when the page is still changing.
5. Extract listing title, canonical URL, price, year, location, and any other fields the user requested. Prefer result-card containers; use matching listing anchors as a fallback when the card structure changes.
6. Traverse result pagination or infinite scrolling until the final reachable results page, the requested limit, or a clearly reported blocker. Do not assume the first page is complete.
7. Normalize relative links against `https://makler.md`, remove tracking parameters when possible, and deduplicate by canonical listing URL.
8. Exclude parts, dismantling, wanted ads, rentals, and unrelated models unless the user explicitly asks for them. Open ambiguous listings when the result card is insufficient to classify them.
9. Return a concise list with the requested fields and URLs. State how many result pages were inspected, how many unique listings matched, and any limitation that prevented a complete search.

## Recovery

- If an element is stale after navigation, take a new page state and resolve it again semantically; never retry an old element ID in a loop.
- If the active tab detaches, list current tabs and continue in the Makler results tab instead of starting another profile.
- If extraction returns no rows, verify the search URL and visible results, then retry once with a broader stable container such as listing links.
- If proxy verification fails, stop before website interaction and ask whether to retry or continue without the requested proxy.
