# Commands in the chat composer

The interaction follows the [Hermes slash-command reference](https://hermes-agent.nousresearch.com/docs/reference/slash-commands/): type `/` to filter commands, use arrows to navigate, and Tab/Enter to insert a selection. Insertion does not execute the command. Submit the completed command to run it. Escape dismisses suggestions; Shift+Enter and IME composition retain normal text-entry behavior.

The catalog in `src/lib/agentChatCommands.ts` contains actual Nextbrowser client actions, not arbitrary prompts or shell commands:

| Command | Action |
| --- | --- |
| `/new [name]`, `/reset`, `/clear` | Create a fresh project, retaining the previous conversation. |
| `/sessions` | Open the existing recent-project selector. |
| `/title [name]` | Show or rename the current project. |
| `/stop`, `/retry` | Stop this project's response or resend its last user message. |
| `/history` | Scroll to the beginning of the conversation. |
| `/model`, `/config` | Open the app's agent settings; these commands take no model ID arguments. |
| `/skills`, `/scripts`, `/usage` | Open the corresponding application surface. |
| `/status`, `/version` | Report local agent state and the detected version without a model call. |
| `/help` | Open the available-command list. |

This is a supported subset, not a transparent Hermes TUI transport. In particular, `/compress`, native model-ID switching and other unimplemented native commands show an explanation and are never queued as model prompts. Add an adapter implementation before advertising another command. The selected agent remains unchanged; the UI convention is shared across agents.

Reuse the shared `CommandList` for suggestions, with the composer as its anchor. It portals outside the composer's backdrop root so glass blurs the actual conversation, while the textarea retains keyboard focus. The project selector likewise floats over the scroll area instead of reserving a header row.
