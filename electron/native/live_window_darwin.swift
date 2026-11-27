// macOS counterpart of live_window_windows.go, built the same way.
//
// The browser stays a separate top-level window, placed exactly under the
// Processes panel and ordered directly below the Nextbrowser window, which is
// transparent there (the renderer clips its own content) and lets the mouse
// through except over its own controls. macOS has no public way to reorder,
// clip or restyle another process's window, so this helper moves the browser
// through the Accessibility API and asks Nextbrowser to reorder itself. That
// needs the user's Accessibility permission; without it the helper reports
// `"permission": "accessibility"` and does nothing.
//
// Protocol: one JSON request per stdin line, one JSON response per stdout
// line, plus unsolicited event lines (`{"event": ...}`), like the Windows helper.
import AppKit
import ApplicationServices
import Darwin

setvbuf(stdout, nil, _IOLBF, 0)
// A busy or animating browser must not stall the helper: Nextbrowser gives
// up on it after 4 s without a reply.
AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
}

// Set NEXTBROWSER_LIVE_WINDOW_LOG to a file path to trace window placement.
let debugLog: FileHandle? = ProcessInfo.processInfo.environment["NEXTBROWSER_LIVE_WINDOW_LOG"].flatMap { path in
  FileManager.default.createFile(atPath: path, contents: nil)
  return FileHandle(forWritingAtPath: path)
}

func debug(_ message: @autoclosure () -> String) {
  guard let debugLog else { return }
  debugLog.seekToEndOfFile()
  debugLog.write(Data("\(Date().timeIntervalSince1970) \(message())\n".utf8))
}

func number(_ value: Any?) -> Double? {
  guard let value = value as? NSNumber, value.doubleValue.isFinite else { return nil }
  return value.doubleValue
}

func rect(_ raw: Any?) -> CGRect? {
  guard let box = raw as? [String: Any],
        let x = number(box["x"]), let y = number(box["y"]),
        let width = number(box["width"]), let height = number(box["height"]),
        width >= 1, height >= 1 else { return nil }
  return CGRect(x: x, y: y, width: width, height: height)
}

// The host window frame (global, from Electron, which keeps its real frame
// while macOS animates a Space change), and the panel and app controls over
// it relative to that frame, in points. nil while the browser must be hidden.
struct Layout {
  let host: CGRect
  let bounds: CGRect
  let controls: [CGRect]

  init?(_ raw: Any?) {
    guard let layout = raw as? [String: Any], layout["hidden"] as? Bool != true,
          let host = rect(layout["host"]), let bounds = rect(layout["bounds"]) else { return nil }
    self.host = host
    self.bounds = bounds
    controls = (layout["controls"] as? [Any] ?? []).prefix(32).compactMap(rect)
  }
}

func executablePath(_ pid: pid_t) -> String? {
  var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
  let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
  return length > 0 ? String(cString: buffer) : nil
}

func sameFile(_ left: String, _ right: String) -> Bool {
  if left == right { return true }
  var a = stat(), b = stat()
  return stat(left, &a) == 0 && stat(right, &b) == 0 && a.st_dev == b.st_dev && a.st_ino == b.st_ino
}

func matchesExecutable(_ pid: pid_t, _ executable: String) -> Bool {
  guard let actual = executablePath(pid) else { return false }
  return sameFile(actual, executable)
}

func processTree(_ root: pid_t) -> [pid_t] {
  let capacity = proc_listallpids(nil, 0)
  guard capacity > 0 else { return [root] }
  var pids = [pid_t](repeating: 0, count: Int(capacity) * 2)
  let count = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
  var children: [pid_t: [pid_t]] = [:]
  for pid in pids.prefix(Int(max(0, count))) where pid > 0 {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    if proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size {
      children[pid_t(info.pbi_ppid), default: []].append(pid)
    }
  }
  var result = [root], queue = [root]
  while !queue.isEmpty {
    let parent = queue.removeFirst()
    for child in children[parent] ?? [] where !result.contains(child) {
      result.append(child)
      queue.append(child)
    }
  }
  return result
}

func attribute<T>(_ element: AXUIElement, _ name: String, _ type: T.Type) -> T? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value as? T
}

func frame(of window: AXUIElement) -> CGRect? {
  var position = CGPoint.zero, size = CGSize.zero
  guard let positionValue = attribute(window, kAXPositionAttribute, AXValue.self),
        let sizeValue = attribute(window, kAXSizeAttribute, AXValue.self),
        AXValueGetValue(positionValue, .cgPoint, &position),
        AXValueGetValue(sizeValue, .cgSize, &size) else { return nil }
  return CGRect(origin: position, size: size)
}

func setFrame(_ window: AXUIElement, _ target: CGRect) {
  var origin = target.origin, size = target.size
  guard let position = AXValueCreate(.cgPoint, &origin), let extent = AXValueCreate(.cgSize, &size) else { return }
  // Size first so the move is not clamped to the screen, then size again in
  // case the old origin limited the first resize.
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, extent)
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position)
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, extent)
}

struct CGWindow {
  let id: CGWindowID
  let pid: pid_t
  let bounds: CGRect
}

func onScreenWindows() -> [CGWindow] {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.compactMap { info in
    guard (info[kCGWindowLayer as String] as? Int) == 0,
          let id = info[kCGWindowNumber as String] as? CGWindowID,
          let pid = info[kCGWindowOwnerPID as String] as? pid_t,
          let boundsInfo = info[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: boundsInfo) else { return nil }
    return CGWindow(id: id, pid: pid, bounds: bounds)
  }
}

func close(_ a: CGRect, _ b: CGRect, tolerance: CGFloat = 1) -> Bool {
  abs(a.minX - b.minX) <= tolerance && abs(a.minY - b.minY) <= tolerance &&
    abs(a.width - b.width) <= tolerance && abs(a.height - b.height) <= tolerance
}

// Where a press can move or resize a browser window: its tab strip, which
// doubles as the title bar, and its edges.
func grabZone(_ frame: CGRect) -> CGRect {
  frame.isNull ? .null : frame.insetBy(dx: -8, dy: -8)
}

func grabbed(_ frame: CGRect, _ point: CGPoint) -> Bool {
  guard !frame.isNull, grabZone(frame).contains(point) else { return false }
  let inner = frame.insetBy(dx: 8, dy: 8)
  return point.y < frame.minY + 44 || !inner.contains(point)
}

func mouseButtonDown() -> Bool {
  [.left, .right, .center].contains { CGEventSource.buttonState(.combinedSessionState, button: $0) }
}

final class Attachment {
  var host: CGWindowID = 0
  var pid: pid_t = 0
  var window: AXUIElement?
  var browserID: CGWindowID = 0
  var originalFrame: CGRect?
  var attached = false
  var layout: Layout?
  var hiddenByHelper = false
  var focused = false
  var passthrough = false
  var lastRaise = Date.distantPast
  var lastHostOrder = Date.distantPast
  var lastRecovery = Date.distantPast
  var recoveries = 0
  // When both windows last became visible; macOS shows windows a moment later.
  var visibleSince = Date.distantFuture
  var lastLookup = Date.distantPast
  var visible = false
  var desired = CGRect.null
  var lastPlace = Date.distantPast
  // The browser frame at the previous check, to tell a drag from a resize.
  var observed = CGRect.null
  var reportedFrame: CGRect?? = .none
  var mouseDownAt: CGPoint?
  var fastUntil = Date.distantPast
  var idleTicks = 0

  var processAlive: Bool { pid > 0 && kill(pid, 0) == 0 }

  // The browser window was closed when its accessibility element went away.
  var alive: Bool {
    guard processAlive else { return false }
    guard let window else { return true }
    var role: CFTypeRef?
    return AXUIElementCopyAttributeValue(window, kAXRoleAttribute as CFString, &role) == .success
  }

  // The browser process for the request: the managed one, or for Camoufox a
  // descendant of the Playwright bridge running the expected executable, as on
  // Windows. It must own a normal window on some Space; a headless browser
  // has none and needs a restart.
  func browserProcess(_ request: [String: Any]) -> pid_t? {
    guard let root = (request["pid"] as? NSNumber)?.int32Value, root > 0,
          let executable = request["executable"] as? String, !executable.isEmpty else { return nil }
    let candidates = request["runtime"] as? String == "camoufox" ? processTree(root) : [root]
    let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for _ in 0..<10 {
      for candidate in candidates where matchesExecutable(candidate, executable) {
        let owns = windows.contains { info in
          guard (info[kCGWindowOwnerPID as String] as? pid_t) == candidate, (info[kCGWindowLayer as String] as? Int) == 0,
                let bounds = (info[kCGWindowBounds as String] as? NSDictionary).flatMap({ CGRect(dictionaryRepresentation: $0) }) else { return false }
          return bounds.width >= 200 && bounds.height >= 150
        }
        if owns { return candidate }
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return nil
  }

  // Accessibility lists only windows on the current Space.
  func standardWindow(_ pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var windows: [AXUIElement] = []
    if let main = attribute(app, kAXMainWindowAttribute, AXUIElement.self) { windows.append(main) }
    windows += attribute(app, kAXWindowsAttribute, [AXUIElement].self) ?? []
    return windows.first { attribute($0, kAXSubroleAttribute, String.self) == kAXStandardWindowSubrole }
  }

  func adopt(_ found: AXUIElement) {
    window = found
    originalFrame = frame(of: found)
  }

  func attach(_ request: [String: Any]) -> [String: Any] {
    if attached { return ["error": "A browser is already attached"] }
    guard AXIsProcessTrusted() else {
      return ["attached": false, "available": false, "permission": "accessibility"]
    }
    guard let hostID = (request["host"] as? NSNumber)?.uint32Value, hostID != 0 else {
      return ["error": "Missing host window"]
    }
    if !alive {
      guard let candidate = browserProcess(request) else { return ["attached": false, "available": false] }
      pid = candidate
      window = nil
      // Off the current Space, the window is adopted once it appears on it.
      let deadline = Date().addingTimeInterval(1.5)
      while window == nil, Date() < deadline {
        if let found = standardWindow(pid) { adopt(found) } else { Thread.sleep(forTimeInterval: 0.1) }
      }
    } else if let root = (request["pid"] as? NSNumber)?.int32Value,
              request["runtime"] as? String == "camoufox" ? !processTree(root).contains(pid) : root != pid {
      return ["attached": false, "available": false]
    }
    host = hostID
    attached = true
    browserID = 0
    desired = .null
    observed = .null
    reportedFrame = .none
    layout = Layout(request["layout"])
    fastUntil = Date().addingTimeInterval(2)
    tick(force: true)
    return ["attached": true, "available": true]
  }

  func detach() -> [String: Any] {
    guard attached else { return ["available": alive] }
    attached = false
    reportFocus(false)
    reportVisible(false)
    setPassthrough(false)
    showBrowser()
    if alive, let window, let originalFrame { setFrame(window, originalFrame) }
    return ["available": alive]
  }

  func update(_ request: [String: Any]) -> [String: Any] {
    layout = Layout(request["layout"])
    fastUntil = Date().addingTimeInterval(1)
    tick(force: true)
    return ["attached": attached, "available": alive]
  }

  func hideBrowser() {
    setPassthrough(false)
    guard !hiddenByHelper, let app = NSRunningApplication(processIdentifier: pid) else { return }
    hiddenByHelper = app.isHidden || app.hide()
    debug("hide \(hiddenByHelper)")
  }

  func showBrowser() {
    guard hiddenByHelper else { return }
    hiddenByHelper = false
    NSRunningApplication(processIdentifier: pid)?.unhide()
    debug("unhide")
  }

  // Nextbrowser opens its transparent panel only over a placed browser.
  func reportVisible(_ next: Bool) {
    guard next != visible else { return }
    visible = next
    emit(["event": "browser-visible", "visible": next])
  }

  func reportFocus(_ next: Bool) {
    guard next != focused else { return }
    focused = next
    emit(["event": "browser-focus", "focused": next])
  }

  // Nextbrowser ignores the mouse over the panel, so clicks, scrolling and
  // hovering reach the browser below it; its own controls keep the mouse.
  func setPassthrough(_ next: Bool) {
    guard next != passthrough else { return }
    passthrough = next
    emit(["event": "pointer", "passthrough": next])
  }

  // The part of the panel the browser really covers, when macOS kept it
  // smaller than the panel, so Nextbrowser can match its transparent area.
  func reportFrame(_ next: CGRect?) {
    if case .some(let previous) = reportedFrame, previous == next { return }
    reportedFrame = .some(next)
    guard let next else {
      emit(["event": "browser-frame"])
      return
    }
    emit(["event": "browser-frame", "frame": ["x": next.minX, "y": next.minY, "width": next.width, "height": next.height]])
  }

  func trackPointer() {
    let down = mouseButtonDown()
    let location = CGEvent(source: nil)?.location
    if !down { mouseDownAt = nil } else if mouseDownAt == nil { mouseDownAt = location ?? .zero }
    guard let layout, visible, !hiddenByHelper, let location else {
      setPassthrough(false)
      return
    }
    // Keep the current target for the whole press, so drags are not split.
    if down { return }
    let point = CGPoint(x: location.x - layout.host.minX, y: location.y - layout.host.minY)
    setPassthrough(layout.bounds.contains(point) && !layout.controls.contains { $0.contains(point) })
  }

  // Runs every 16 ms; the window list is read every 100 ms while nothing moves.
  func tick(force: Bool = false) {
    guard attached else { return }
    let now = Date()
    trackPointer()
    if force || now < fastUntil || mouseDownAt != nil { idleTicks = 0 } else {
      idleTicks += 1
      if idleTicks % 6 != 0 { return }
    }
    if processAlive, window == nil, now.timeIntervalSince(lastLookup) > 0.5 {
      lastLookup = now
      if let found = standardWindow(pid) { adopt(found) }
    }
    guard alive, let window else {
      reportFocus(false)
      reportVisible(false)
      setPassthrough(false)
      return
    }
    guard let layout else {
      // A modal, another tab, or a minimized or hidden Nextbrowser window.
      reportFocus(false)
      reportVisible(false)
      visibleSince = .distantFuture
      hideBrowser()
      return
    }
    var windows = onScreenWindows()
    var browserIndex = windows.firstIndex(where: { $0.id == browserID })
    guard var hostIndex = windows.firstIndex(where: { $0.id == host }) else {
      // Nextbrowser is on another Space. The browser normally went with it;
      // if it is still on screen, it must not stay there alone.
      reportFocus(false)
      reportVisible(false)
      visibleSince = .distantFuture
      if browserIndex != nil { hideBrowser() }
      return
    }
    if hiddenByHelper || visibleSince == .distantFuture { visibleSince = now }
    showBrowser()
    if attribute(window, kAXMinimizedAttribute, Bool.self) == true {
      AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    }
    if attribute(window, "AXFullScreen", Bool.self) == true {
      AXUIElementSetAttributeValue(window, "AXFullScreen" as CFString, kCFBooleanFalse)
    }
    // One point of overlap hides the hairline edge of the browser window.
    let target = layout.bounds.offsetBy(dx: layout.host.minX, dy: layout.host.minY).insetBy(dx: -1, dy: -1)
    if browserIndex == nil {
      browserID = (windows.first { $0.pid == pid && close($0.bounds, target, tolerance: 2) }
        ?? windows.filter { $0.pid == pid }.max { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height })?.id ?? 0
      browserIndex = windows.firstIndex(where: { $0.id == browserID })
    }
    // The window server has the real frame; the browser's accessibility
    // frame can lag behind its own resizes while it starts.
    let current = browserIndex.map { windows[$0].bounds } ?? frame(of: window)
    let moving = current.map { !observed.isNull && !close($0, observed, tolerance: 0.5) } ?? false
    if moving, let current, let down = mouseDownAt, grabbed(observed, down) {
      // The user grabbed the browser's tab strip or an edge. End that drag,
      // as the Windows helper does with WM_CANCELMODE.
      CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGEvent(source: nil)?.location ?? down,
              mouseButton: .left)?.post(tap: .cghidEventTap)
      debug("cancel drag from \(down) frame=\(current)")
    }
    observed = current ?? .null
    let changed = !close(target, desired, tolerance: 0.5)
    if changed || (current.map { !close($0, target, tolerance: 0.5) } ?? true) &&
        (moving || now.timeIntervalSince(lastPlace) > 1) {
      // Retried once a second: macOS may keep a window off the Dock, and a
      // starting browser may restore its own size.
      debug("place host=\(layout.host) panel=\(layout.bounds) from=\(current.map { "\($0)" } ?? "nil") to=\(target)")
      setFrame(window, target)
      desired = target
      lastPlace = now
      fastUntil = now.addingTimeInterval(1)
    }
    if !changed, let current, !moving, now.timeIntervalSince(lastPlace) > 0.2 {
      reportFrame(close(current, target, tolerance: 0.5) ? nil
        : current.insetBy(dx: 1, dy: 1).offsetBy(dx: -layout.host.minX, dy: -layout.host.minY))
    }
    if browserIndex == nil {
      // Read the list again: the browser may have just been moved.
      windows = onScreenWindows()
      hostIndex = windows.firstIndex(where: { $0.id == host }) ?? hostIndex
      browserID = windows.first(where: { $0.pid == pid && close($0.bounds, target, tolerance: 2) })?.id ?? 0
      browserIndex = windows.firstIndex(where: { $0.id == browserID })
    }
    guard let browserIndex else {
      reportFocus(false)
      reportVisible(false)
      // No browser window on screen at all: it is on another Space than
      // Nextbrowser. A window restored from the Dock opens on the current Space.
      if !windows.contains(where: { $0.pid == pid }), let app = NSRunningApplication(processIdentifier: pid), !app.isHidden,
         now.timeIntervalSince(visibleSince) > 2, now.timeIntervalSince(lastRecovery) > 3, recoveries < 2 {
        lastRecovery = now
        recoveries += 1
        debug("recover from another Space")
        AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
          AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }
      }
      return
    }
    recoveries = 0
    reportVisible(true)
    reportFocus(NSWorkspace.shared.frontmostApplication?.processIdentifier == pid)
    // While either window is in front, Nextbrowser must lie directly above
    // the browser, as on Windows.
    guard hostIndex == 0 || browserIndex == 0, browserIndex != hostIndex + 1 else { return }
    fastUntil = now.addingTimeInterval(1)
    let hostPID = windows[hostIndex].pid
    if hostIndex < browserIndex,
       windows[(hostIndex + 1)..<browserIndex].contains(where: { $0.pid != hostPID }),
       now.timeIntervalSince(lastRaise) > 0.15 {
      // Another app's window lies between them. AXRaise cannot lift the
      // browser above the active app, but it lifts it above inactive ones.
      lastRaise = now
      let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
      debug("raise host=\(hostIndex) browser=\(browserIndex) result=\(raised.rawValue)")
    } else if browserIndex < hostIndex, now.timeIntervalSince(lastHostOrder) > 0.05 {
      // The browser came forward (it was clicked). Only Nextbrowser may
      // reorder its own window; focus stays in the browser.
      lastHostOrder = now
      debug("host-order host=\(hostIndex) browser=\(browserIndex)")
      emit(["event": "host-order", "above": browserID])
    }
  }
}

let attachment = Attachment()

func handle(_ line: String) {
  guard let data = line.data(using: .utf8),
        let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
    emit(["error": "Invalid request"])
    return
  }
  switch request["operation"] as? String {
  case "attach": emit(attachment.attach(request))
  case "layout": emit(attachment.update(request))
  case "status": emit(["attached": attachment.attached, "available": attachment.alive])
  case "detach": emit(attachment.detach())
  default: emit(["error": "Unknown window operation"])
  }
}

Thread.detachNewThread {
  while let line = readLine() {
    DispatchQueue.main.async { handle(line) }
  }
  DispatchQueue.main.async {
    _ = attachment.detach()
    exit(0)
  }
}

let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in attachment.tick() }
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
