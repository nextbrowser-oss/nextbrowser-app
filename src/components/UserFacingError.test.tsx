import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { discordUrl } from "../constants";
import { internalError } from "../lib/userFacingError";
import { UserFacingError } from "./UserFacingError";

describe("UserFacingError", () => {
  it("renders internal support as a clickable Discord link", () => {
    const html = renderToStaticMarkup(
      <UserFacingError message={internalError("We couldn't finish the action.")} surface="test" />,
    );

    expect(html).toContain(`href="${discordUrl}"`);
    expect(html).toContain("Get help in Discord.");
  });

  it("keeps user input errors focused on the correction", () => {
    const html = renderToStaticMarkup(
      <UserFacingError message="Enter a valid proxy URL." surface="test" />,
    );

    expect(html).toContain("Enter a valid proxy URL.");
    expect(html).not.toContain("href=");
  });
});
