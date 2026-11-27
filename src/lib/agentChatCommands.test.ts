import { expect, it } from "vitest";
import { matchingAgentChatCommands, parseAgentChatCommand } from "./agentChatCommands";

it("parses commands and preserves arguments without treating them as shell", () => {
  expect(parseAgentChatCommand(" /TITLE My project ")).toEqual({ name: "title", rawName: "title", args: "My project" });
  expect(parseAgentChatCommand("/new $(whoami)")?.args).toBe("$(whoami)");
});
it.each(["reset", "clear"])("maps Hermes /%s to a fresh session", alias => {
  expect(parseAgentChatCommand("/" + alias)?.name).toBe("new");
});
it.each(["compress", "constructor", "model-something"])("reports unsupported /%s explicitly", name => {
  expect(parseAgentChatCommand("/" + name)?.name).toBeUndefined();
});
it("does not intercept ordinary prompts and file paths", () => {
  expect(parseAgentChatCommand("Please /stop later")).toBeUndefined();
  expect(parseAgentChatCommand("/tmp/file.txt")).toBeUndefined();
});
it("filters completion without opening a menu for arguments or multiline messages", () => {
  expect(matchingAgentChatCommands("/TI").map(command => command.name)).toEqual(["title"]);
  expect(matchingAgentChatCommands("/reset").map(command => command.name)).toEqual(["new"]);
  expect(matchingAgentChatCommands("/title My project")).toEqual([]);
  expect(matchingAgentChatCommands("hello\n/new")).toEqual([]);
});
