---
name: example-product-search
description: Search and extract product listings from example.com with optional proxy verification, pagination, filtering, and canonical URL deduplication.
---

# Example product search

Use Clawbrowser to search the product catalog on `example.com` and return complete, relevant results.

1. Start or reattach one named profile. Verify any proxy country requested by the user before interacting with the website; do not restart a successfully verified profile.
2. Resolve search and filter controls from the current page by role, label, text, or stable selector. Treat captured element IDs as short-lived hints.
3. Apply the requested query and filters, then confirm the visible page reflects them before extraction.
4. Extract title, canonical URL, price, availability, and any fields requested by the user.
5. Traverse pagination or infinite scrolling until the final reachable page, requested limit, or a clearly reported blocker.
6. Normalize URLs, remove tracking parameters where possible, deduplicate by canonical URL, and exclude irrelevant matches.
7. If navigation makes an element stale, take a new page state and resolve it semantically. If the tab detaches, continue in the matching current tab instead of starting another profile.
8. Return concise results with source URLs, pages inspected, unique match count, and any limitation that prevented completeness.
