package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	frameStyle      = 0x00cf0000 // WS_CAPTION, WS_THICKFRAME, WS_SYSMENU and min/max boxes.
	captionStyle    = 0x00c00000 // WS_CAPTION
	styleIndex      = ^uintptr(15)
	exStyleIndex    = ^uintptr(19)
	edgeStyles      = 0x00020301 // WS_EX_STATICEDGE, WS_EX_CLIENTEDGE, WS_EX_WINDOWEDGE, WS_EX_DLGMODALFRAME.
	appWindowStyle  = 0x00040000
	toolWindowStyle = 0x00000080 // WS_EX_TOOLWINDOW
	minimizedStyle  = 0x20000000
	maximizedStyle  = 0x01000000
	frameChanged    = 0x0020
	show            = 0x0040
	moveSizeStart   = 0x000a // EVENT_SYSTEM_MOVESIZESTART
	moveSizeEnd     = 0x000b // EVENT_SYSTEM_MOVESIZEEND
	cancelMode      = 0x001f // WM_CANCELMODE
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	enumWindows     = user32.NewProc("EnumWindows")
	getForeground   = user32.NewProc("GetForegroundWindow")
	getPID          = user32.NewProc("GetWindowThreadProcessId")
	getClass        = user32.NewProc("GetClassNameW")
	isVisible       = user32.NewProc("IsWindowVisible")
	isWindow        = user32.NewProc("IsWindow")
	isIconic        = user32.NewProc("IsIconic")
	isZoomed        = user32.NewProc("IsZoomed")
	showWindow      = user32.NewProc("ShowWindow")
	getStyle        = user32.NewProc("GetWindowLongPtrW")
	setStyle        = user32.NewProc("SetWindowLongPtrW")
	getWindow       = user32.NewProc("GetWindow")
	getRect         = user32.NewProc("GetWindowRect")
	getClient       = user32.NewProc("GetClientRect")
	clientToScreen  = user32.NewProc("ClientToScreen")
	setPos          = user32.NewProc("SetWindowPos")
	setWinEventHook = user32.NewProc("SetWinEventHook")
	unhookWinEvent  = user32.NewProc("UnhookWinEvent")
	peekMessage     = user32.NewProc("PeekMessageW")
	postMessage     = user32.NewProc("PostMessageW")
	dispatchMessage = user32.NewProc("DispatchMessageW")
	getDPI          = user32.NewProc("GetDpiForWindow")
	setDPI          = user32.NewProc("SetThreadDpiAwarenessContext")
	getWindowRegion = user32.NewProc("GetWindowRgn")
	setWindowRegion = user32.NewProc("SetWindowRgn")
	gdi32           = syscall.NewLazyDLL("gdi32.dll")
	createRegion    = gdi32.NewProc("CreateRectRgn")
	createRoundRect = gdi32.NewProc("CreateRoundRectRgn")
	combineRegion   = gdi32.NewProc("CombineRgn")
	deleteObject    = gdi32.NewProc("DeleteObject")
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	setLastError    = kernel32.NewProc("SetLastError")
	queryImage      = kernel32.NewProc("QueryFullProcessImageNameW")
)

type rect struct{ Left, Top, Right, Bottom int32 }
type point struct{ X, Y int32 }
type frameInsets struct{ left, top, right, bottom int32 }

type message struct {
	window         uintptr
	id             uint32
	wParam, lParam uintptr
	time           uint32
	point          point
	private        uint32
}

type request struct {
	Operation  string
	Host       uint64
	PID        uint32
	Executable string
	Runtime    string
	Layout     layout
}

type box struct{ X, Y, Width, Height, Radius int32 }

type layout struct {
	Bounds box
	Holes  []box
	Hidden bool
	Fill   bool
}

type response struct {
	Error     string `json:"error,omitempty"`
	Attached  bool   `json:"attached"`
	Available bool   `json:"available"`
}

type attachment struct {
	window, host, style, exStyle, originalRegion uintptr
	pid                                          uint32
	bounds, embeddedBounds                       rect
	attached                                     bool
	moveHook                                     uintptr
	lastLayout                                   layout
	clippedTo                                    box
	hostSize                                     box
	hostCutout                                   box
	hostControls                                 []box
	hostClipped                                  bool
}

func matchesExecutable(pid uint32, executable string) bool {
	process, err := syscall.OpenProcess(0x1000, false, pid) // PROCESS_QUERY_LIMITED_INFORMATION
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(process)
	name := make([]uint16, 32768)
	length := uint32(len(name))
	ok, _, _ := queryImage.Call(uintptr(process), 0, uintptr(unsafe.Pointer(&name[0])), uintptr(unsafe.Pointer(&length)))
	if ok == 0 {
		return false
	}
	actual := syscall.UTF16ToString(name[:length])
	if strings.EqualFold(actual, executable) {
		return true
	}
	expectedFile, expectedErr := os.Stat(executable)
	actualFile, actualErr := os.Stat(actual)
	return expectedErr == nil && actualErr == nil && os.SameFile(expectedFile, actualFile)
}

func browserProcessTree(pid uint32) map[uint32]bool {
	processes := map[uint32]bool{pid: true}
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return processes
	}
	defer syscall.CloseHandle(snapshot)
	children := make(map[uint32][]uint32)
	entry := syscall.ProcessEntry32{Size: uint32(unsafe.Sizeof(syscall.ProcessEntry32{}))}
	for err := syscall.Process32First(snapshot, &entry); err == nil; err = syscall.Process32Next(snapshot, &entry) {
		children[entry.ParentProcessID] = append(children[entry.ParentProcessID], entry.ProcessID)
	}
	queue := []uint32{pid}
	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		for _, child := range children[parent] {
			if !processes[child] {
				processes[child] = true
				queue = append(queue, child)
			}
		}
	}
	return processes
}

func findBrowserWindow(r request) (uintptr, uint32) {
	pids := map[uint32]bool{r.PID: true}
	windowClass := "Chrome_WidgetWin_1"
	if r.Runtime == "camoufox" {
		// nextctl tracks the Playwright bridge. Only the matching browser
		// executable in that bridge's process tree may be attached.
		pids = browserProcessTree(r.PID)
		windowClass = "MozillaWindowClass"
	}
	var found uintptr
	var foundPID uint32
	callback := syscall.NewCallback(func(window, _ uintptr) uintptr {
		var windowPID uint32
		getPID.Call(window, uintptr(unsafe.Pointer(&windowPID)))
		visible, _, _ := isVisible.Call(window)
		if !pids[windowPID] || visible == 0 {
			return 1
		}
		if style, _, _ := getStyle.Call(window, styleIndex); style&captionStyle != captionStyle {
			return 1
		}
		if owner, _, _ := getWindow.Call(window, 4); owner != 0 { // GW_OWNER
			return 1
		}
		var class [128]uint16
		getClass.Call(window, uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
		if syscall.UTF16ToString(class[:]) != windowClass || !matchesExecutable(windowPID, r.Executable) {
			return 1
		}
		found = window
		foundPID = windowPID
		return 0
	})
	enumWindows.Call(callback, 0)
	return found, foundPID
}

func position(window uintptr, x, y, width, height int32, flags uintptr) error {
	const keepOrderAndFocus = 0x0004 | 0x0010
	ok, _, err := setPos.Call(window, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height), flags|keepOrderAndFocus)
	if ok == 0 {
		return fmt.Errorf("SetWindowPos: %w", err)
	}
	return nil
}

func (a *attachment) attach(r request) (response, error) {
	if a.attached {
		return response{}, errors.New("A browser is already attached")
	}
	host := uintptr(r.Host)
	if host == 0 || r.PID == 0 || r.Executable == "" {
		return response{}, errors.New("Missing host window or browser PID")
	}
	if r.Runtime != "camoufox" && !matchesExecutable(r.PID, r.Executable) {
		return response{}, nil
	}
	window := a.window
	browserPID := a.pid
	if window != 0 {
		if !a.alive() || !matchesExecutable(browserPID, r.Executable) ||
			(r.Runtime == "camoufox" && !browserProcessTree(r.PID)[browserPID]) ||
			(r.Runtime != "camoufox" && browserPID != r.PID) {
			return response{}, nil
		}
	} else {
		for i := 0; i < 10; i++ {
			window, browserPID = findBrowserWindow(r)
			if window != 0 {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	if window == 0 {
		return response{}, nil
	}
	iconic, _, _ := isIconic.Call(window)
	zoomed, _, _ := isZoomed.Call(window)
	if iconic != 0 || zoomed != 0 {
		showWindow.Call(window, 9) // SW_RESTORE before changing parent or measuring bounds.
	}
	style, _, _ := getStyle.Call(window, styleIndex)
	var bounds rect
	ok, _, err := getRect.Call(window, uintptr(unsafe.Pointer(&bounds)))
	if ok == 0 {
		return response{}, fmt.Errorf("GetWindowRect: %w", err)
	}
	originalRegion, _, _ := createRegion.Call(0, 0, 0, 0)
	if originalRegion != 0 {
		if kind, _, _ := getWindowRegion.Call(window, originalRegion); kind == 0 {
			deleteObject.Call(originalRegion)
			originalRegion = 0
		}
	}
	exStyle, _, _ := getStyle.Call(window, exStyleIndex)
	if err := changeStyle(window, styleIndex, style&^(frameStyle|minimizedStyle|maximizedStyle)); err != nil {
		if originalRegion != 0 {
			deleteObject.Call(originalRegion)
		}
		return response{}, err
	}
	// Keep native focus and input in the browser. Its taskbar entry is
	// represented by the Nextbrowser host while the windows are paired.
	if err := changeStyle(window, exStyleIndex, exStyle&^(edgeStyles|appWindowStyle)|toolWindowStyle); err != nil {
		_ = changeStyle(window, styleIndex, style)
		_ = changeStyle(window, exStyleIndex, exStyle)
		if originalRegion != 0 {
			deleteObject.Call(originalRegion)
		}
		_ = position(window, bounds.Left, bounds.Top, bounds.Right-bounds.Left, bounds.Bottom-bounds.Top, frameChanged|show)
		return response{}, err
	}
	*a = attachment{window: window, host: host, style: style, exStyle: exStyle, bounds: bounds, originalRegion: originalRegion, pid: browserPID, attached: true}
	callback := syscall.NewCallback(func(_ uintptr, event, hwnd, object, child, _, _ uintptr) uintptr {
		if !a.attached || hwnd != a.window || object != 0 || child != 0 {
			return 0
		}
		if event == moveSizeStart {
			postMessage.Call(hwnd, cancelMode, 0, 0)
		}
		_, _ = a.update(a.lastLayout)
		return 0
	})
	a.moveHook, _, _ = setWinEventHook.Call(moveSizeStart, moveSizeEnd, 0, callback, uintptr(browserPID), 0, 0)
	if a.moveHook == 0 {
		_ = a.detach()
		return response{}, errors.New("Could not monitor the embedded window's move and resize events")
	}
	result, err := a.update(r.Layout)
	if err != nil {
		_ = a.detach()
	}
	return result, err
}

func changeStyle(window, index, style uintptr) error {
	setLastError.Call(0)
	old, _, err := setStyle.Call(window, index, style)
	if old == 0 && err != syscall.Errno(0) {
		return fmt.Errorf("SetWindowLongPtr: %w", err)
	}
	return nil
}

func (a *attachment) alive() bool {
	if ok, _, _ := isWindow.Call(a.window); ok == 0 {
		return false
	}
	var pid uint32
	getPID.Call(a.window, uintptr(unsafe.Pointer(&pid)))
	return pid == a.pid
}

func (a *attachment) update(l layout) (response, error) {
	if !a.alive() {
		return response{}, a.restoreHost()
	}
	result := response{Attached: a.attached, Available: true}
	if !a.attached {
		return result, nil
	}
	a.lastLayout = l
	a.embeddedBounds = rect{}
	visible, _, _ := isVisible.Call(a.window)
	hostMinimized, _, _ := isIconic.Call(a.host)
	hostVisible, _, _ := isVisible.Call(a.host)
	if l.Hidden || hostMinimized != 0 || hostVisible == 0 || l.Bounds.Width < 1 || l.Bounds.Height < 1 {
		if visible != 0 {
			showWindow.Call(a.window, 0)
		}
		return result, a.restoreHost()
	}
	var client rect
	ok, _, err := getClient.Call(a.host, uintptr(unsafe.Pointer(&client)))
	if ok == 0 {
		return response{}, fmt.Errorf("GetClientRect: %w", err)
	}
	hostDPI, _, _ := getDPI.Call(a.host)
	if hostDPI == 0 {
		hostDPI = 96
	}
	pixels := func(value int32) int32 { return int32((int64(value)*int64(hostDPI) + 48) / 96) }
	x := min(client.Right, pixels(l.Bounds.X))
	y := min(client.Bottom, pixels(l.Bounds.Y))
	width := min(client.Right-x, pixels(l.Bounds.X+l.Bounds.Width)-x)
	height := min(client.Bottom-y, pixels(l.Bounds.Y+l.Bounds.Height)-y)
	if l.Fill {
		width, height = client.Right-x, client.Bottom-y
	}
	if width < 1 || height < 1 {
		if visible != 0 {
			showWindow.Call(a.window, 0)
		}
		return result, a.restoreHost()
	}
	firstLayout := a.clippedTo.Width == 0
	var hostOrigin point
	if ok, _, err := clientToScreen.Call(a.host, uintptr(unsafe.Pointer(&hostOrigin))); ok == 0 {
		return response{}, fmt.Errorf("ClientToScreen: %w", err)
	}
	if firstLayout {
		// Let the browser recalculate its client area for the embedded window styles.
		if err := position(a.window, hostOrigin.X+x, hostOrigin.Y+y, width, height, frameChanged); err != nil {
			return response{}, err
		}
	}
	current, insets := browserFrame(a.window)
	windowX, windowY := x-insets.left, y-insets.top
	windowWidth, windowHeight := width+insets.left+insets.right, height+insets.top+insets.bottom
	area := box{X: insets.left, Y: insets.top, Width: width, Height: height}
	if a.clippedTo != area {
		if err := shapeWindow(a.window, area, box{}, nil); err != nil {
			return response{}, err
		}
		a.clippedTo = area
	}
	windowX += hostOrigin.X
	windowY += hostOrigin.Y
	if visible == 0 || current.Left != windowX || current.Top != windowY ||
		current.Right-current.Left != windowWidth || current.Bottom-current.Top != windowHeight {
		var flags uintptr
		if visible == 0 {
			flags |= show
		}
		if err := position(a.window, windowX, windowY, windowWidth, windowHeight, flags); err != nil {
			return response{}, err
		}
	}
	a.embeddedBounds = rect{windowX, windowY, windowX + windowWidth, windowY + windowHeight}
	a.keepHostAboveBrowser()
	hostFrame, hostInsets := browserFrame(a.host)
	hostSize := box{Width: hostFrame.Right - hostFrame.Left, Height: hostFrame.Bottom - hostFrame.Top}
	// The non-client resize frame remains outside this cutout. Cutting the
	// whole browser area out of the client avoids painting strips over it.
	cutout := box{X: hostInsets.left + x, Y: hostInsets.top + y, Width: width, Height: height}
	controls := make([]box, 0, len(l.Holes))
	for _, hole := range l.Holes {
		left, top := pixels(hole.X), pixels(hole.Y)
		controls = append(controls, box{
			X: left + hostInsets.left, Y: top + hostInsets.top,
			Width: pixels(hole.X+hole.Width) - left, Height: pixels(hole.Y+hole.Height) - top,
			Radius: pixels(hole.Radius),
		})
	}
	if !a.hostClipped || a.hostSize != hostSize || a.hostCutout != cutout || !reflect.DeepEqual(a.hostControls, controls) {
		if err := shapeWindow(a.host, hostSize, cutout, controls); err != nil {
			return response{}, err
		}
		a.hostClipped, a.hostSize, a.hostCutout, a.hostControls = true, hostSize, cutout, controls
	}
	return result, nil
}

func (a *attachment) keepHostAboveBrowser() {
	foreground, _, _ := getForeground.Call()
	if foreground != a.host && foreground != a.window {
		return
	}
	if next, _, _ := getWindow.Call(a.host, 2); next == a.window { // GW_HWNDNEXT
		return
	}
	const keepBoundsFocusAndOwner = 0x0001 | 0x0002 | 0x0010 | 0x0200
	if foreground == a.host {
		setPos.Call(a.window, a.host, 0, 0, 0, 0, keepBoundsFocusAndOwner)
		return
	}
	previous, _, _ := getWindow.Call(a.window, 3) // GW_HWNDPREV
	if previous != 0 {
		if style, _, _ := getStyle.Call(previous, exStyleIndex); style&0x00000008 != 0 { // WS_EX_TOPMOST
			previous = 0 // HWND_TOP within the non-topmost group
		}
	}
	setPos.Call(a.host, previous, 0, 0, 0, 0, keepBoundsFocusAndOwner)
}

func (a *attachment) syncBrowserWindow() {
	if !a.attached || a.embeddedBounds == (rect{}) {
		return
	}
	if !a.alive() {
		_ = a.restoreHost()
		return
	}
	a.keepHostAboveBrowser()
	var actual rect
	if ok, _, _ := getRect.Call(a.window, uintptr(unsafe.Pointer(&actual))); ok != 0 && actual != a.embeddedBounds {
		// Some browser windows do not emit location events for every move.
		postMessage.Call(a.window, cancelMode, 0, 0)
		_, _ = a.update(a.lastLayout)
	}
}

func browserFrame(window uintptr) (rect, frameInsets) {
	var outer, client rect
	var origin point
	getRect.Call(window, uintptr(unsafe.Pointer(&outer)))
	clientOK, _, _ := getClient.Call(window, uintptr(unsafe.Pointer(&client)))
	originOK, _, _ := clientToScreen.Call(window, uintptr(unsafe.Pointer(&origin)))
	if clientOK == 0 || originOK == 0 {
		return outer, frameInsets{}
	}
	return outer, frameInsets{
		left: max(0, origin.X-outer.Left), top: max(0, origin.Y-outer.Top),
		right: max(0, outer.Right-origin.X-client.Right), bottom: max(0, outer.Bottom-origin.Y-client.Bottom),
	}
}

func shapeWindow(window uintptr, area, cutout box, controls []box) error {
	region, _, _ := createRegion.Call(uintptr(area.X), uintptr(area.Y), uintptr(area.X+area.Width), uintptr(area.Y+area.Height))
	if region == 0 {
		return errors.New("Could not allocate the window region")
	}
	combine := func(partBox box, mode uintptr) bool {
		left, top := uintptr(partBox.X), uintptr(partBox.Y)
		right, bottom := uintptr(partBox.X+partBox.Width), uintptr(partBox.Y+partBox.Height)
		var part uintptr
		if partBox.Radius > 0 {
			diameter := uintptr(partBox.Radius * 2)
			// GDI excludes the bottom/right pixel of a rounded region.
			part, _, _ = createRoundRect.Call(left, top, right+1, bottom+1, diameter, diameter)
		} else {
			part, _, _ = createRegion.Call(left, top, right, bottom)
		}
		if part == 0 {
			return false
		}
		kind, _, _ := combineRegion.Call(region, region, part, mode)
		deleteObject.Call(part)
		return kind != 0
	}
	if cutout.Width > 0 && !combine(cutout, 4) { // RGN_DIFF
		deleteObject.Call(region)
		return errors.New("Could not open the browser area in the host window")
	}
	for _, control := range controls {
		if !combine(control, 2) { // RGN_OR
			deleteObject.Call(region)
			return errors.New("Could not add a control to the host window region")
		}
	}
	ok, _, _ := setWindowRegion.Call(window, region, 1)
	if ok == 0 {
		deleteObject.Call(region)
		return errors.New("Could not apply the window region")
	}
	return nil // Windows owns region after SetWindowRgn succeeds.
}

func (a *attachment) restoreHost() error {
	if !a.hostClipped {
		return nil
	}
	if alive, _, _ := isWindow.Call(a.host); alive != 0 {
		if ok, _, err := setWindowRegion.Call(a.host, 0, 1); ok == 0 {
			return fmt.Errorf("Could not restore the host window: %w", err)
		}
	}
	a.hostClipped = false
	return nil
}

func (a *attachment) detach() error {
	if !a.attached {
		return nil
	}
	if a.moveHook != 0 {
		unhookWinEvent.Call(a.moveHook)
		a.moveHook = 0
	}
	hostErr := a.restoreHost()
	if !a.alive() {
		if a.originalRegion != 0 {
			deleteObject.Call(a.originalRegion)
		}
		*a = attachment{}
		return hostErr
	}
	window, bounds := a.window, a.bounds
	styleErr := changeStyle(window, styleIndex, a.style)
	exStyleErr := changeStyle(window, exStyleIndex, a.exStyle)
	if ok, _, _ := setWindowRegion.Call(window, a.originalRegion, 1); ok == 0 && a.originalRegion != 0 {
		deleteObject.Call(a.originalRegion)
	}
	a.originalRegion = 0
	a.attached = false
	return errors.Join(hostErr, styleErr, exStyleErr, position(window, bounds.Left, bounds.Top, bounds.Right-bounds.Left, bounds.Bottom-bounds.Top, frameChanged|show))
}

func main() {
	// Use the host monitor's physical client coordinates.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	setDPI.Call(^uintptr(3))
	var a attachment
	defer a.detach()
	requests := make(chan request)
	go func() {
		defer close(requests)
		in := json.NewDecoder(os.Stdin)
		for {
			var req request
			if err := in.Decode(&req); err != nil {
				if !errors.Is(err, io.EOF) {
					fmt.Fprintln(os.Stderr, err)
				}
				return
			}
			requests <- req
		}
	}()
	out := json.NewEncoder(os.Stdout)
	tick := time.NewTicker(8 * time.Millisecond)
	defer tick.Stop()
	for {
		var req request
		select {
		case next, ok := <-requests:
			if !ok {
				return
			}
			req = next
		case <-tick.C:
			// WinEvent callbacks are delivered on the thread that registered the hook.
			var msg message
			for {
				ok, _, _ := peekMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, 1)
				if ok == 0 {
					break
				}
				dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
			}
			a.syncBrowserWindow()
			continue
		}
		var result response
		var err error
		switch req.Operation {
		case "attach":
			result, err = a.attach(req)
		case "layout":
			result, err = a.update(req.Layout)
		case "status":
			result, err = a.update(a.lastLayout)
		case "detach":
			err = a.detach()
			result = response{Available: a.alive()}
		default:
			err = errors.New("Unknown window operation")
		}
		if err != nil {
			result.Error = err.Error()
		}
		if err := out.Encode(result); err != nil {
			return
		}
	}
}
