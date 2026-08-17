---
name: 999-car-search
description: Search, filter, paginate, and extract relevant vehicle listings from 999.md. Use when a user asks to find or compare cars on 999.md.
---

# 999.md car search

## Workflow

1. Start or reattach one named Clawbrowser profile. If the user requested a proxy country, verify that country before interacting with the site. Never start the same profile repeatedly after a successful start.
2. Open the car listings section and apply the user's make, model, year, mileage, price, fuel, and location criteria using the site's controls or query parameters.
3. Confirm the visible filters before extraction. Search terms can match parts and dismantling listings, so do not treat the raw result count as a count of cars.
4. Extract title, canonical URL, price, year, mileage, location, and the short description when available.
5. Traverse every available result page or scroll boundary requested by the user. Prefer one structured pagination/extraction operation over repeatedly inspecting the full page.
6. Deduplicate by canonical listing URL. Exclude parts, rentals, wanted ads, and dismantling listings unless the user requested them.
7. Return a concise list and state how many pages were inspected, how many raw rows were seen, and how many relevant unique listings remained.

## Recovery

- Treat saved element identifiers as short-lived hints. Resolve controls again by role, label, visible text, or selector after navigation.
- If navigation changes the page target, list tabs once and continue with the matching `999.md` result tab. Do not call start again merely because a target id changed.
- If structured extraction returns no rows, inspect a compact page state once, correct the container or fields, and retry.
- Stop and report the actual blocker if proxy verification, authentication, or the site itself fails twice.

## Output

For each matching car include: title, price, year, mileage, location, and URL. Never claim that all listings were collected unless pagination reached a confirmed end.
