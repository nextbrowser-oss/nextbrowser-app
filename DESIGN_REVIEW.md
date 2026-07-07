# Design Review

Date: 2026-07-07

Scope: initial product UI review using the local `impeccable`, `emil-design-eng`, and `taste-skill` design guidance. `impeccable` is the primary lens because NextBrowser is a product/tool UI; `taste-skill` is used only as an anti-slop filter because it is aimed more at websites and landing pages.

## Applied Changes

| Before | After | Why |
| --- | --- | --- |
| No product context file, so future design critique had no stable product lens. | Added `PRODUCT.md` with register, users, jobs, design direction, anti-references, and accessibility baseline. | Keeps design decisions tied to the actual product instead of subjective taste. |
| Rotate icon used elastic/bounce easing. | Replaced with smooth ease-out timing. | A desktop operations tool should feel precise and stable, not playful. |
| Settings modal only showed the app version. | Settings now shows app version, clawctl version, active agent, dashboard link, and sign-out. | The gear becomes a useful system/status surface without becoming a full settings area too early. |
| Modal rows were loose one-off layout. | Added consistent settings sections and rows. | Makes the surface easier to scan and gives future settings a clear pattern. |
| Motion did not account for reduced-motion preference. | Added a reduced-motion CSS guard. | Aligns with product accessibility baseline and avoids unnecessary animation. |
| Sidebar read as several equal cards. | Reworked it into a control stack with a compact status rail, clearer card titles, and quieter metadata. | Operators can scan agent/proxy/session health before choosing an action. |
| Agent state was buried below the picker. | Added a visible agent status pill and a cleaner connected-version line. | The primary dependency for chat and skills is now visible at the decision point. |
| Profile empty state was passive. | Added an inline empty state with direct next action copy. | Empty states now teach the workflow instead of only reporting absence. |
| Chat empty state was a plain intro. | Turned it into an action-first work panel with connect, skills, session, live view, and a reusable proxy-check prompt. | First-run and idle moments become launch points for real work. |
| Skills gating was a warning sentence. | Replaced it with an inline connection panel and primary action. | Blocked states now explain the dependency and provide the fix in the same place. |
| Settings showed raw rows only. | Added a system health summary and runtime diagnostics. | Settings now supports debugging without becoming a full preferences screen. |

## Remaining Recommendations

| Before | After | Why |
| --- | --- | --- |
| Sidebar has several visually similar cards competing for attention. | Make Proxy Usage, Agent, and Profiles use more differentiated hierarchy: only one primary action per card, quieter secondary metadata. | Helps operators scan state faster. |
| Profile row actions appear only as icons with dense status information nearby. | Preserve icon buttons, but consider grouped hover affordances and stronger selected/running contrast. | Reduces mis-click risk during profile operations. |
| Empty/onboarding states still explain the product more than they guide the next action. | Convert them into direct task entry points: connect agent, create first profile, enter dashboard key. | Product UI should move users into work quickly. |
| Skills and scripts can look equally important even when an agent is not connected. | Gate unavailable actions more explicitly and keep install/apply status close to the action. | Prevents confusion about why a skill did or did not run. |
| Analytics events exist, but there is no in-product diagnostics surface. | Later, add a small diagnostics section in Settings for app version, event source, update channel, and component status. | Makes support/debugging easier without exposing raw logs everywhere. |

## Current Iteration Notes

| Before | After | Why |
| --- | --- | --- |
| Accent and status colors were mostly purple plus generic muted gray. | Added separate info, success, warning, and danger soft tokens while keeping purple as the action accent. | Better status vocabulary without turning the app into a multi-color dashboard. |
| Top navigation floated as separate pills. | Wrapped tabs in a compact segmented control with stable button dimensions. | Reads more like native desktop navigation and reduces visual noise. |
| Repeated uppercase labels used tracking as a style crutch. | Normalized letter spacing to zero across compact product labels. | Avoids the generic “AI dashboard eyebrow” cadence. |
| Composer blended into the canvas. | Gave the composer a restrained surface, border, and focus ring. | The primary input becomes easier to locate and trust. |
| App palette was still mostly inherited purple. | Pulled the best tokens from nextbrowser.com: ink `#1d1c1c`, paper `#f5f5f5`, border `#e3dfdc`, blue `#5865f2`, 8px product buttons, and subtle CTA shadows. | Aligns desktop with the public brand while keeping the product interface restrained and task-focused. |
