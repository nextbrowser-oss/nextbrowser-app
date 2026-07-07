# NextBrowser Product Context

## Product Register

NextBrowser is a product UI: a native desktop console for browser automation with local AI agents, profiles, proxy traffic, skills, scripts, scheduled runs, and live session control.

It is not a marketing site, a decorative dashboard, or a consumer chat toy. The interface should feel like a calm professional tool that can be used repeatedly during real work.

## Primary Users

- AI browser automation operators who run browser sessions through local agents.
- Power users who manage multiple profiles, countries, proxy traffic, skills, and custom scripts.
- Technical users who need clear status, recoverable errors, and predictable controls across macOS and Windows.

## Core Jobs

- Connect a local agent and keep its state understandable.
- Create, start, stop, inspect, rotate, and delete browser profiles.
- Understand proxy traffic usage and top up when needed.
- Send chat requests to the active agent with the right profile/session context.
- Apply skills and scripts without losing trust in what will run.
- Observe a live browser session and recover when local components are missing.

## Design Direction

NextBrowser should feel native, restrained, dense, and legible. The closest references are focused desktop tools such as Raycast, Linear, and Figma Dev Mode: high signal, clear hierarchy, durable controls, and very little decoration.

Color should support status and action, not dominate the product. Purple can remain an accent, but the app should avoid becoming an AI-purple theme.

Motion should be short, directional, and functional. Avoid bounce, elastic, overly playful easing, decorative shimmer, and motion that calls attention to itself.

## Anti-References

- Landing-page hero composition inside the product.
- Glassmorphism for its own sake.
- Large decorative gradients, blobs, or mascot-like empty states.
- Over-carded SaaS dashboards where every group competes for attention.
- Hidden critical state behind vague labels or icon-only controls without tooltips.

## Accessibility Baseline

- Keyboard focus must be visible on all interactive controls.
- Text and status colors should target WCAG AA contrast where practical.
- Controls should keep stable dimensions across states.
- Reduced-motion users should not receive decorative animation.
- Destructive actions must remain explicit and recoverable where possible.

