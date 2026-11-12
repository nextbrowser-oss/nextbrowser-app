import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DesktopShell } from "./components/DesktopShell";
import { installErrorReporting } from "./lib/errorReporting";
import { enterScheduleForeground, flushScheduleHandoff } from "./store";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import { TooltipProvider } from "./shared/ui";

// Before the first render, so errors while the app starts are reported too.
installErrorReporting();
window.nextbrowser?.on("schedule:flush", () => {
  void flushScheduleHandoff().finally(() => window.nextbrowser?.scheduleFlushed?.());
});
window.nextbrowser?.on("schedule:foreground", enterScheduleForeground);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <TooltipProvider><DesktopShell><App /></DesktopShell></TooltipProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
