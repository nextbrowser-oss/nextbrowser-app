import { describe, expect, it } from "vitest";
import {
  VPS_PROMPT_MARKER,
  buildVPSPrompt,
  hasVPSPromptMarker,
  sshCommandForConnection,
  vpsConnectionInstructions,
  type VPSConnection,
} from "./vpsPrompt";

const SSH_OPTIONS = "ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o PermitLocalCommand=no";
const WINDOWS_SSH_OPTIONS = "ssh -F NUL -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o PermitLocalCommand=no";

describe("VPS SSH command preview", () => {
  it("uses only resolved SSH fields instead of loading the source config", () => {
    const connection: VPSConnection = {
      kind: "ssh-config",
      host: {
        alias: "prod-vps",
        hostname: "203.0.113.10",
        user: "deploy",
        port: 22,
        configPath: "/Users/alice/.ssh/config",
        explicitConfig: false,
      },
    };

    expect(sshCommandForConnection(connection)).toBe(`${SSH_OPTIONS} deploy@203.0.113.10`);
  });

  it("does not pass an explicit custom config to ssh", () => {
    const connection: VPSConnection = {
      kind: "ssh-config",
      host: {
        alias: "team-prod",
        configPath: "/Users/alice/SSH configs/team config",
        explicitConfig: true,
      },
    };

    expect(sshCommandForConnection(connection)).toBe(`${SSH_OPTIONS} team-prod`);
  });

  it("builds a manual SSH command with an optional key and port", () => {
    const connection: VPSConnection = {
      kind: "manual",
      host: "vps.example.com",
      user: "root",
      port: 2222,
      identityFile: "/Users/alice/SSH keys/prod key",
    };

    expect(sshCommandForConnection(connection)).toBe(
      `${SSH_OPTIONS} -i '/Users/alice/SSH keys/prod key' -p 2222 root@vps.example.com`,
    );
  });

  it("quotes POSIX paths containing a literal backslash", () => {
    const connection: VPSConnection = {
      kind: "ssh-config",
      host: {
        alias: "team-prod",
        configPath: "/tmp/team\\",
        explicitConfig: true,
        identityFile: "/tmp/team\\",
      },
    };

    expect(sshCommandForConnection(connection)).toBe(
      `${SSH_OPTIONS} -i '/tmp/team\\' team-prod`,
    );
  });

  it("uses Windows double quotes for an identity path with spaces and shell metacharacters", () => {
    const connection: VPSConnection = {
      kind: "ssh-config",
      shellPlatform: "windows",
      host: {
        alias: "team-prod",
        configPath: "C:\\Users\\Alice\\SSH configs\\team & prod.conf",
        explicitConfig: true,
        identityFile: "C:\\Users\\Alice\\SSH keys\\team & prod.key",
      },
    };

    expect(sshCommandForConnection(connection)).toBe(
      `${WINDOWS_SSH_OPTIONS} -i "C:\\Users\\Alice\\SSH keys\\team & prod.key" team-prod`,
    );
  });

  it.each(["%", "!", "^", "$", "`", '\"'])(
    "rejects the Windows interpolation character %s",
    (character) => {
      expect(() =>
        sshCommandForConnection({
          kind: "manual",
          shellPlatform: "windows",
          host: "vps.example.com",
          identityFile: `C:\\keys\\prod${character}key`,
        }),
      ).toThrow("unsafe in a Windows shell");
    },
  );

  it("rejects option, control-character, and destination injection", () => {
    expect(() =>
      sshCommandForConnection({ kind: "manual", host: "-oProxyCommand=bad" }),
    ).toThrow("unsupported characters");
    expect(() =>
      sshCommandForConnection({ kind: "manual", host: "vps.example.com;touch-pwned" }),
    ).toThrow("unsupported characters");
    expect(() =>
      sshCommandForConnection({ kind: "manual", host: "vps.example.com", user: "root $(id)" }),
    ).toThrow("unsupported characters");
    expect(() =>
      sshCommandForConnection({
        kind: "ssh-config",
        host: {
          alias: "prod\nmalicious",
          configPath: "/tmp/config",
          explicitConfig: true,
        },
      }),
    ).toThrow("control characters");
  });
});

describe("VPS prompt", () => {
  it("requires a read-only, no-update remote preflight", () => {
    const prompt = buildVPSPrompt({
      kind: "ssh-config",
      host: {
        alias: "prod-vps",
        hostname: "203.0.113.10",
        user: "deploy",
        configPath: "/Users/alice/.ssh/config",
        explicitConfig: false,
      },
    });

    expect(prompt).toContain(VPS_PROMPT_MARKER);
    expect(hasVPSPromptMarker(prompt)).toBe(true);
    expect(prompt).toContain("strict remote-only mode");
    expect(prompt).toContain("command -v clawctl");
    expect(prompt).toContain("CLAWCTL_AUTO_UPDATE=0 clawctl version");
    expect(prompt).not.toContain("clawctl doctor");
    expect(prompt).toContain("perform only this read-only preflight");
    expect(prompt).toContain("already-installed Clawbrowser runtime");
    expect(prompt).toContain(
      "Clawbrowser or clawctl is not installed on this VPS. Install Clawbrowser and clawctl on the VPS first, then retry.",
    );
    expect(prompt).toContain("Do not install, download, update, configure, initialize, repair, or start anything automatically.");
    expect(prompt).toContain("prefix every remote `clawctl` invocation with `CLAWCTL_AUTO_UPDATE=0`");
    expect(prompt).toContain("never fall back to local execution");
    expect(prompt).toContain(`${SSH_OPTIONS} deploy@203.0.113.10`);
    expect(prompt).toContain("deliberately does not load the source SSH config");
    expect(prompt).not.toContain(" -F /Users/alice/.ssh/config");
  });

  it("appends a requested task after the remote preflight without carrying it into follow-ups", () => {
    const prompt = buildVPSPrompt(
      { kind: "manual", host: "198.51.100.20", user: "root" },
      "Open example.com and take a screenshot.",
    );

    expect(prompt).toContain("After the remote preflight passes");
    expect(prompt).toContain("Open example.com and take a screenshot.");
    expect(vpsConnectionInstructions(prompt)).not.toContain(
      "Open example.com and take a screenshot.",
    );
    expect(vpsConnectionInstructions(prompt)).toContain("CLAWCTL_AUTO_UPDATE=0");
  });
});
