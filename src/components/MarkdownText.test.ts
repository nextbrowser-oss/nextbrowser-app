import { describe, expect, it } from "vitest";
import { containingFolderPath, fileNameFromPath, localFileLinks } from "./MarkdownText";

describe("local file markdown links", () => {
  it("recognizes macOS paths containing spaces", () => {
    expect(localFileLinks("[Open](</Users/me/Application Support/report.txt>)")).toMatchObject([
      { label: "Open", path: "/Users/me/Application Support/report.txt" },
    ]);
  });

  it("recognizes Windows drive and UNC paths", () => {
    expect(localFileLinks("[A](<C:\\Users\\me\\report.txt>) [B](<\\\\server\\share\\file.csv>)").map((x) => x.path))
      .toEqual(["C:\\Users\\me\\report.txt", "\\\\server\\share\\file.csv"]);
  });

  it("does not treat web links as local files", () => {
    expect(localFileLinks("[Site](https://example.com/file.txt)")).toEqual([]);
  });

  it("finds containing folders on macOS and Windows", () => {
    expect(containingFolderPath("/Users/me/Application Support/report.txt")).toBe("/Users/me/Application Support");
    expect(containingFolderPath("C:\\Users\\me\\report.txt")).toBe("C:\\Users\\me");
    expect(containingFolderPath("\\\\server\\share\\report.txt")).toBe("\\\\server\\share");
  });

  it("uses the real filename instead of the agent's link label", () => {
    expect(fileNameFromPath("/tmp/hello.txt")).toBe("hello.txt");
    expect(fileNameFromPath("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });
});
