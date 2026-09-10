function sourceRevision(appPath, execFileSync) {
  try {
    const revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: appPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(revision) ? revision : undefined;
  } catch {
    return undefined;
  }
}

function feedbackBuildContext({ app, execFileSync }) {
  if (app.isPackaged) {
    return { app_version: app.getVersion(), build: "release" };
  }

  const revision = sourceRevision(app.getAppPath(), execFileSync);
  return {
    app_version: revision ? `development-${revision}` : "development",
    build: "development",
  };
}

module.exports = { feedbackBuildContext, sourceRevision };
