# NextBrowser Analytics

GA4 stream: `G-MDQWQ9LRCN`.

The desktop app identifies events with `event_source=nextbrowser_desktop` and
`app_surface=desktop`, so app traffic can be separated from website traffic in
reports and explorations.

## Collection Rules

- Every event includes `session_id`, `session_number`, `engagement_time_msec`,
  `page_location`, `page_title`, `app_instance_id`, `app_version`,
  `app_platform`, and `app_locale`.
- Startup sends `first_visit` once per app install, plus `session_start` and
  `page_view` every app launch.
- Tab changes send both `screen_view` and `page_view`.
- The app sends `user_engagement` on a heartbeat and when hidden/closed.
- `gtag.js` is the primary sender. A `/g/collect` fallback is used only when
  the Google tag fails to load, avoiding duplicate event counts.
- If a dashboard API key resolves to an owner id, it is sent as GA4 `user_id`;
  otherwise the persistent anonymous app instance id is used as `client_id`.

## Core Events

- App lifecycle: `app_start`, `app_visibility_changed`, `app_close`,
  `app_update_status`, `theme_changed`, `screen_view`, `page_view`,
  `user_engagement`.
- Dashboard/auth: `dashboard_key_prompt_opened`,
  `dashboard_key_prompt_closed`, `dashboard_key_save_started`,
  `dashboard_key_save_succeeded`, `dashboard_key_save_failed`,
  `dashboard_opened`, `dashboard_logout`, `login`.
- Runtime: `bootstrap_started`, `bootstrap_completed`, `nextctl_detected`,
  `nextctl_missing`, `nextctl_update_started`, `nextctl_update_completed`,
  `nextctl_update_failed`.
- Proxy/session/profile: `proxy_loaded`, `proxy_refresh_started`,
  `proxy_refresh_succeeded`, `proxy_traffic_gate_discord_opened`,
  `session_start_requested`, `session_stop_requested`,
  `session_rotate_requested`, `profile_start_requested`,
  `profile_stop_requested`, `profile_rotate_requested`,
  `profile_delete_requested`, `profile_manual_proxy_create_requested`.
- Agents/chat: `agent_switched`, `agent_connect_started`,
  `agent_connect_succeeded`, `agent_connect_failed`, `agent_turn_started`,
  `agent_turn_completed`, `agent_turn_failed`, `chat_created`,
  `chat_selected`, `chat_deleted`, `chat_request_submitted`,
  `chat_message_queued`, `chat_files_selected`.
- Skills/scripts/schedules: `skill_catalog_loaded`, `skill_apply_started`,
  `skill_apply_completed`, `skill_used_in_chat`, `script_run_started`,
  `script_run_completed`, `script_run_failed`, `custom_script_save_completed`,
  `scheduled_run_created`, `scheduled_run_fired`, `scheduled_run_start_failed`.

## Onboarding Funnel

First launch to the first successful browser task. These events carry step
ids, enums, counts, and booleans only: never emails, profile or project names,
prompts, or URLs.

- `workspace_auto_setup_completed` / `workspace_auto_setup_failed`: first-run
  defaults for a new account (`profiles_created`, `profiles_failed`,
  `duration_ms`).
- `onboarding_started` (`trigger`: `first_run`, `new_version`, `replay`).
- `onboarding_step_viewed` (`step`, `step_number`, `trigger`). The tour
  coming back from a setup it stepped aside for is not a new view.
- `onboarding_step_completed` (`step`, `step_number`, `via`, `ready`): the
  user left the step forward, once per step and tour run. `ready` says whether
  the step's own criterion held (account connected, agent ready, selected
  profile running, example sent to Chat).
- `onboarding_resumed` (`step`, `failed`): the tour returned after sign-in,
  profile setup, or a profile start.
- `onboarding_closed` (`reason`: `completed` or `skipped`, `last_step`,
  `trigger`, `steps_completed`, `duration_ms`, `agent_ready`,
  `profile_count`).
- `browser_runtime_download_prompted` (`runtime`),
  `browser_runtime_download_decided` (`runtime`, `decision`: `download` or
  `cancel`), `browser_runtime_download_stopped` (`runtime`).
- `first_task_submitted` and `first_task_succeeded`, once per install
  (`agent`, `execution_target`, `from_example`, `onboarding_done`; submitted
  also has `chip_kind`). Success means a reply finished while a browser
  profile of the chat's workspace was running at the start or end of the
  turn. Installs that had sent tasks before these events existed never send
  them.

## Recommended GA4 Custom Dimensions

Create these as event-scoped custom dimensions when you need them in standard
reports. They are immediately usable in Explorations after registration.

- `event_source`
- `app_surface`
- `app_version`
- `app_platform`
- `agent`
- `tab`
- `screen_name`
- `proxy_state`
- `country`
- `category`
- `selector_kind`
- `script_type`
- `chip_kind`
- `update_status`
- `reason`
- `step`, `via`, `ready`, `trigger`, `decision`, `runtime`, `from_example`

Recommended custom metrics:

- `duration_ms`
- `profile_count`
- `step_number`, `steps_completed`, `profiles_created`, `profiles_failed`
- `conversation_count`
- `attachment_count`
- `prompt_length_bucket`
- `percent_used_bucket`
