try {
  require('./main.cjs');
} catch (error) {
  if (process.env.NEXTBROWSER_SMOKE_LAUNCH === '1') {
    process.stderr.write(`Nextbrowser main process failed during startup:\n${error.stack || error}\n`);
    process.exit(1);
  } else {
    throw error;
  }
}
