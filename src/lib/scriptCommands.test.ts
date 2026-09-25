import { expect, it } from "vitest";
import { publicScriptJavaScript } from "./scriptCommands";

it("runs the known public Hello World script on the selected profile", () => {
  expect(publicScriptJavaScript("hello-world.script")).toContain('d.textContent="Hello, world! 👋"');
  expect(publicScriptJavaScript("another.script")).toBeUndefined();
});
