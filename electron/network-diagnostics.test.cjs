const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createClientErrorReporter } = require("./client-error-reporter.cjs");
const { describeBackendRequest } = require("./backend-fetch.cjs");
const { describeInvokeFailure } = require("./invoke-failure-report.cjs");
const { describeNbcResult } = require("./nbc-failure-report.cjs");
const { describeProfileFailureEvent, describeProfileStartFailure } = require("./profile-start-failure.cjs");
const {
  FIELD_ORDER,
  addressClass,
  createNetworkDiagnostics,
  describeEnvProxy,
  describeGnomeProxy,
  describeMacDns,
  describeMacProxy,
  describeProxyList,
  describeResolvConf,
  describeWindowsDns,
  describeWindowsProxy,
  hostPortClass,
  interfaceFamily,
  parseGnomeProxy,
  parseIfconfig,
  parseInternetSettings,
  parseIpLink,
  parseLinuxRoute,
  parseMacRoute,
  parseRoutePrint,
  parseScutilDns,
  parseScutilProxy,
  parseWinhttpProxy,
  proxyURLClass,
  wantsNetworkDiagnostics,
  windowsAdapterFamily,
  windowsDefaults,
  windowsLinks,
} = require("./network-diagnostics.cjs");

// ---- Sample outputs (addresses, MACs and names are made up) -----------------

const MAC_PROXY_SYSTEM = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
    2 : *.local
    3 : 192.168.0.0/16
  }
  ExcludeSimpleHostnames : 1
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 10808
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 10808
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://127.0.0.1:10808/pac/proxy.js?t=1729
  SOCKSEnable : 1
  SOCKSPort : 10808
  SOCKSProxy : 127.0.0.1
  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      ExceptionsList : <array> {
        0 : *.local
      }
      HTTPEnable : 1
      HTTPPort : 10808
      HTTPProxy : 127.0.0.1
    }
  }
}
`;

const MAC_PROXY_CORPORATE = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 3128
  HTTPProxy : proxy.corp.example.com
  HTTPSEnable : 0
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://wpad.corp.example.com/proxy.pac
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : 10.20.30.40
}
`;

const MAC_PROXY_OFF = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 0
  HTTPSEnable : 0
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 0
}
`;

// Happ-like TUN mode: the default resolver is the tunnel's fake-ip DNS.
const MAC_DNS_TUN = `DNS configuration

resolver #1
  search domain[0] : home.example.lan
  nameserver[0] : 198.18.0.2
  if_index : 24 (utun4)
  flags    : Request A records, Request AAAA records
  reach    : 0x00000003 (Reachable,Transient Connection)

resolver #2
  domain   : local
  options  : mdns
  timeout  : 5
  flags    : Request A records, Request AAAA records
  reach    : 0x00000000 (Not Reachable)
  order    : 300000

resolver #3
  domain   : 254.169.in-addr.arpa
  options  : mdns
  timeout  : 5
  flags    : Request A records, Request AAAA records
  reach    : 0x00000000 (Not Reachable)
  order    : 300200

DNS configuration (for scoped queries)

resolver #1
  search domain[0] : home.example.lan
  nameserver[0] : 192.168.1.1
  nameserver[1] : fe80::1%en0
  if_index : 6 (en0)
  flags    : Scoped, Request A records
  reach    : 0x00020002 (Reachable,Directly Reachable Address)

resolver #2
  nameserver[0] : 198.18.0.2
  if_index : 24 (utun4)
  flags    : Scoped, Request A records, Request AAAA records
  reach    : 0x00000003 (Reachable,Transient Connection)
`;

// A corporate VPN with split DNS: a resolver for nodemaven.com inside the tunnel.
const MAC_DNS_SPLIT = `DNS configuration

resolver #1
  nameserver[0] : 192.168.1.1
  if_index : 6 (en0)
  flags    : Request A records
  reach    : 0x00020002 (Reachable,Directly Reachable Address)

resolver #2
  domain   : corp.example.com
  nameserver[0] : 10.0.0.53
  if_index : 25 (utun5)
  flags    : Request A records
  reach    : 0x00000003 (Reachable,Transient Connection)
  order    : 1

resolver #3
  domain   : nodemaven.com
  nameserver[0] : 10.0.0.53
  if_index : 25 (utun5)
  flags    : Request A records
  reach    : 0x00000003 (Reachable,Transient Connection)
  order    : 2

resolver #4
  domain   : local
  options  : mdns
  timeout  : 5
  flags    : Request A records, Request AAAA records
  reach    : 0x00000000 (Not Reachable)
  order    : 300000
`;

const MAC_DNS_PLAIN = `DNS configuration

resolver #1
  nameserver[0] : 192.168.1.1
  if_index : 6 (en0)
  flags    : Request A records
  reach    : 0x00020002 (Reachable,Directly Reachable Address)

DNS configuration (for scoped queries)

resolver #1
  nameserver[0] : 192.168.1.1
  if_index : 6 (en0)
  flags    : Scoped, Request A records
  reach    : 0x00020002 (Reachable,Directly Reachable Address)
`;

const macRoute = (iface, gateway) => `   route to: default
destination: default
       mask: default
    gateway: ${gateway}
  interface: ${iface}
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
 recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire
       0         0         0         0         0         0      1500         0
`;
const MAC_ROUTE_UTUN = macRoute("utun4", "198.18.0.1");
const MAC_ROUTE_EN0 = macRoute("en0", "192.168.1.1");

const MAC_IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	options=1203<RXCSUM,TXCSUM,TXSTATUS,SW_TIMESTAMP>
	inet 127.0.0.1 netmask 0xff000000
	inet6 ::1 prefixlen 128
	inet6 fe80::1%lo0 prefixlen 64 scopeid 0x1
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	options=6460<TSO4,TSO6,CHANNEL_IO,PARTIAL_CSUM,ZEROINVERT_CSUM>
	ether a4:83:e7:11:22:33
	inet6 fe80::1c2b:3a4d:5e6f:7a8b%en0 prefixlen 64 secured scopeid 0x6
	inet 192.168.1.23 netmask 0xffffff00 broadcast 192.168.1.255
	inet6 2a02:1234:5678:9abc:1c2b:3a4d:5e6f:7a8b prefixlen 64 autoconf secured
	nd6 options=201<PERFORMNUD,DAD>
	media: autoselect
	status: active
awdl0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether 7a:11:22:33:44:55
	inet6 fe80::7811:22ff:fe33:4455%awdl0 prefixlen 64 scopeid 0xb
utun0: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380
	inet6 fe80::d4f1:1a2b:3c4d:5e6f%utun0 prefixlen 64 scopeid 0x10
	nd6 options=201<PERFORMNUD,DAD>
utun1: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 2000
	inet6 fe80::6e2c:aa11:bb22:cc33%utun1 prefixlen 64 scopeid 0x11
	nd6 options=201<PERFORMNUD,DAD>
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 9000
	inet 198.18.0.1 --> 198.18.0.1 netmask 0xffff0000
utun5: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280
`;

const MAC_INTERFACES = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }, { address: "::1", family: "IPv6", internal: true }],
  en0: [
    { address: "fe80::1c2b:3a4d:5e6f:7a8b", family: "IPv6", internal: false },
    { address: "192.168.1.23", family: "IPv4", internal: false, mac: "a4:83:e7:11:22:33" },
    { address: "2a02:1234:5678:9abc:1c2b:3a4d:5e6f:7a8b", family: "IPv6", internal: false },
  ],
  utun0: [{ address: "fe80::d4f1:1a2b:3c4d:5e6f", family: "IPv6", internal: false }],
  utun1: [{ address: "fe80::6e2c:aa11:bb22:cc33", family: "IPv6", internal: false }],
  utun4: [{ address: "198.18.0.1", family: "IPv4", internal: false }],
};

const WINDOWS_REG_SYSTEM = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    DisableCachingOfSSLPages    REG_DWORD    0x0
    IE5_UA_Backup_Flag    REG_SZ    5.0
    PrivacyAdvanced    REG_DWORD    0x1
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:10809
    ProxyOverride    REG_SZ    localhost;127.*;10.*;172.16.*;172.17.*;192.168.*;<local>
    AutoConfigURL    REG_SZ    http://127.0.0.1:10809/pac/?t=1729

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\5.0
`;
const WINDOWS_REG_PER_PROTOCOL = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=proxy.corp.example.com:3128;https=10.1.2.3:3128;socks=127.0.0.1:10808
    ProxyOverride    REG_SZ    *.corp.example.com;<local>
`;
const WINDOWS_REG_OFF = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    127.0.0.1:10809
`;
const WINHTTP_DIRECT = `
Current WinHTTP proxy settings:

    Direct access (no proxy server).

`;
const WINHTTP_PROXY = `
Current WinHTTP proxy settings:

    Proxy Server(s) :  127.0.0.1:10809
    Bypass List     :  (none)

`;
// Localized labels must not matter.
const WINHTTP_PROXY_RU = `
Текущие параметры прокси-сервера WinHTTP:

    Прокси-серверы:  10.8.0.1:3128
    Список обхода  :  (нет)
`;

const WINDOWS_ROUTE_PRINT = `===========================================================================
Interface List
 18...00 ff 3a 4b 5c 6d ......Wintun Userspace Tunnel
 12...a4 83 e7 11 22 33 ......Intel(R) Wi-Fi 6 AX201 160MHz
  1...........................Software Loopback Interface 1
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.100     35
          0.0.0.0        128.0.0.0         On-link        172.19.0.1      5
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
        128.0.0.0        128.0.0.0         On-link        172.19.0.1      5
      192.168.1.0    255.255.255.0         On-link     192.168.1.100    291
===========================================================================
Persistent Routes:
  Network Address          Netmask  Gateway Address  Metric
          0.0.0.0          0.0.0.0      192.168.1.1  Default
===========================================================================
`;

// What the PowerShell call returns on a Windows machine running a sing-box
// based client in TUN mode: the Wintun adapter is named after the app.
const WINDOWS_REPORT_TUN = {
  routes: [
    { prefix: "0.0.0.0/0", ifIndex: 12, metric: 35 },
    { prefix: "0.0.0.0/1", ifIndex: 18, metric: 5 },
    { prefix: "128.0.0.0/1", ifIndex: 18, metric: 5 },
    { prefix: "::/0", ifIndex: 12, metric: 256 },
  ],
  adapters: [
    { ifIndex: 18, alias: "Happ", description: "Wintun Userspace Tunnel", hardware: false, ifType: 53, up: true },
    { ifIndex: 12, alias: "Wi-Fi", description: "Intel(R) Wi-Fi 6 AX201 160MHz", hardware: true, ifType: 71, up: true },
    { ifIndex: 21, alias: "vEthernet (WSL)", description: "Hyper-V Virtual Ethernet Adapter", hardware: false, ifType: 6, up: true },
  ],
  interfaces: [
    { ifIndex: 18, alias: "Happ", mtu: 9000 },
    { ifIndex: 12, alias: "Wi-Fi", mtu: 1500 },
    { ifIndex: 1, alias: "Loopback Pseudo-Interface 1", mtu: 4294967295 },
  ],
  dns: [
    { ifIndex: 18, servers: ["172.19.0.2"] },
    { ifIndex: 12, servers: ["192.168.1.1", "fe80::1"] },
  ],
  api_ifIndex: 18,
};
const WINDOWS_INTERFACES = {
  Happ: [{ address: "172.19.0.1", family: "IPv4", internal: false }],
  "Wi-Fi": [
    { address: "192.168.1.100", family: "IPv4", internal: false },
    { address: "2a02:1234:5678:9abc::100", family: "IPv6", internal: false },
  ],
  "vEthernet (WSL)": [{ address: "172.28.0.1", family: "IPv4", internal: false }],
  "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

const LINUX_ROUTE = `default via 192.168.1.1 dev wlp2s0 proto dhcp src 192.168.1.5 metric 600
default via 10.8.0.1 dev tun0 proto static metric 50
`;
const LINUX_LINKS = String.raw`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00 promiscuity 0 minmtu 0 maxmtu 0 addrgenmode eui64 numtxqueues 1 numrxqueues 1
2: wlp2s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DORMANT group default qlen 1000\    link/ether 3c:22:fb:11:22:33 brd ff:ff:ff:ff:ff:ff promiscuity 0 minmtu 256 maxmtu 2304 addrgenmode none
5: tun0: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1420 qdisc fq_codel state UNKNOWN mode DEFAULT group default qlen 500\    link/none  promiscuity 0 minmtu 68 maxmtu 65535 \    tun type tun pi off vnet_hdr off persist off addrgenmode random
6: wg-corp: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1380 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\    link/none  promiscuity 0 minmtu 0 maxmtu 2147483552 \    wireguard addrgenmode none
7: tailscale0: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1280 qdisc fq_codel state UNKNOWN mode DEFAULT group default qlen 500\    link/none  promiscuity 0 minmtu 68 maxmtu 65535 \    tun type tun pi off vnet_hdr on persist on addrgenmode random
8: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN mode DEFAULT group default\    link/ether 02:42:ac:11:00:01 brd ff:ff:ff:ff:ff:ff promiscuity 0 bridge forward_delay 1500
`;
const LINUX_RESOLV = `# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).
nameserver 127.0.0.53
options edns0 trust-ad
search home.example.lan
`;
const LINUX_GSETTINGS = `org.gnome.system.proxy autoconfig-url ''
org.gnome.system.proxy ignore-hosts ['localhost', '127.0.0.0/8', '::1']
org.gnome.system.proxy mode 'manual'
org.gnome.system.proxy use-same-proxy true
org.gnome.system.proxy.ftp host ''
org.gnome.system.proxy.ftp port 0
org.gnome.system.proxy.http authentication-password 'hunter2'
org.gnome.system.proxy.http authentication-user 'alice'
org.gnome.system.proxy.http enabled false
org.gnome.system.proxy.http host '127.0.0.1'
org.gnome.system.proxy.http port 10808
org.gnome.system.proxy.http use-authentication false
org.gnome.system.proxy.https host '127.0.0.1'
org.gnome.system.proxy.https port 10808
org.gnome.system.proxy.socks host 'socks.corp.example.com'
org.gnome.system.proxy.socks port 1080
`;

// ---- Fakes ---------------------------------------------------------------------

function fakeExec(outputs, calls = []) {
  return (file, args, options, callback) => {
    const key = `${path.win32.basename(String(file)).toLowerCase()} ${args.join(" ")}`.trim();
    calls.push(key);
    const entry = typeof outputs === "function" ? outputs(key) : outputs[key];
    setImmediate(() => {
      if (entry === undefined) return callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
      if (entry === "hang") return undefined;
      if (typeof entry === "string") return callback(null, entry, "");
      return callback(entry.error ? Object.assign(new Error("failed"), { code: entry.error }) : null, entry.stdout || "", entry.stderr || "");
    });
  };
}

function fakeSocket({ event, error, remoteAddress, delay = 0 }) {
  return () => {
    const socket = new EventEmitter();
    socket.remoteAddress = remoteAddress;
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    if (event !== "hang") {
      setTimeout(() => (error ? socket.emit("error", Object.assign(new Error(error), { code: error })) : socket.emit(event)), delay);
    }
    return socket;
  };
}

function fakeLookup(answers, calls = []) {
  return async (host, options) => {
    calls.push({ host, options });
    const answer = answers[host];
    if (answer === "hang") return new Promise(() => {});
    if (typeof answer === "string") throw Object.assign(new Error(`getaddrinfo ${answer} ${host}`), { code: answer });
    return answer;
  };
}

function clock(start = 1_000_000) {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

const MAC_HAPP_TUN = {
  "route -n get default": MAC_ROUTE_UTUN,
  "route -n get -inet6 default": { error: "exit1", stderr: "route: writing to routing socket: not in table" },
  "route -n get 198.18.0.7": MAC_ROUTE_UTUN.replace("route to: default", "route to: 198.18.0.7"),
  ifconfig: MAC_IFCONFIG,
  "scutil --proxy": MAC_PROXY_OFF,
  "scutil --dns": MAC_DNS_TUN,
};

function macHappDiagnostics(overrides = {}) {
  const time = clock();
  return createNetworkDiagnostics({
    platform: "darwin",
    env: {},
    execFileImpl: fakeExec(MAC_HAPP_TUN),
    lookupImpl: fakeLookup({ "api.nextbrowser.com": [{ address: "198.18.0.7", family: 4 }], "gate.nodemaven.com": [{ address: "198.18.0.8", family: 4 }] }),
    connectImpl: (options) => fakeSocket({ event: "connect", remoteAddress: options.host === "api.nextbrowser.com" ? "198.18.0.7" : "198.18.0.8" })(),
    tlsConnectImpl: fakeSocket({ event: "hang" }),
    resolveProxyImpl: async () => "DIRECT",
    networkInterfacesImpl: () => MAC_INTERFACES,
    now: time.now,
    timeouts: { tls: 30, total: 500 },
    ...overrides,
  });
}

// ---- Classes -------------------------------------------------------------------

test("addresses are reported by class only", () => {
  const cases = {
    "198.18.0.2": "fakeip",
    "198.19.255.254": "fakeip",
    "198.20.0.1": "public",
    "100.64.0.1": "cgnat",
    "100.127.255.255": "cgnat",
    "100.128.0.1": "public",
    "10.0.0.1": "private",
    "172.16.5.4": "private",
    "172.31.255.255": "private",
    "172.32.0.1": "public",
    "192.168.1.1": "private",
    "127.0.0.53": "loopback",
    "169.254.10.10": "linklocal",
    "0.0.0.0": "unspecified",
    "224.0.0.251": "multicast",
    "93.184.216.34": "public",
    "::1": "loopback",
    "::": "unspecified",
    "fe80::1%en0": "ipv6-linklocal",
    "fd12:3456::1": "ipv6-ula",
    "fc00::1": "ipv6-ula",
    "2a02:1234::1": "ipv6-global",
    "[2001:db8::1]": "ipv6-global",
    "::ffff:192.168.1.1": "private",
    "ff02::fb": "multicast",
    "64:ff9b::1": "ipv6-other",
    "not an address": "",
  };
  for (const [address, expected] of Object.entries(cases)) assert.equal(addressClass(address), expected, address);
  assert.equal(hostPortClass("127.0.0.1:10808"), "loopback:10808");
  assert.equal(hostPortClass("[::1]:1080"), "loopback:1080");
  assert.equal(hostPortClass("localhost:7890"), "loopback:7890");
  assert.equal(hostPortClass("10.1.2.3:3128"), "private", "ports only for this computer");
  assert.equal(hostPortClass("proxy.corp.example.com:8080"), "host");
  assert.equal(proxyURLClass("socks5://user:secret@127.0.0.1:7891"), "socks5://loopback:7891");
  assert.equal(proxyURLClass("http://proxy.corp.example.com:3128"), "http://host");
  assert.equal(proxyURLClass("100.64.1.1:8080"), "http://cgnat");
});

test("interfaces are reported by family, never by name", () => {
  const cases = {
    utun4: "utun", tun0: "tun", tap1: "tap", wg0: "wg", ppp0: "ppp", ipsec0: "ipsec",
    en0: "physical", eth0: "physical", enp3s0: "physical", wlp2s0: "physical", wlan0: "physical", "Wi-Fi": "physical", "Ethernet 2": "physical",
    lo0: "loopback", lo: "loopback", awdl0: "other", bridge0: "other", tailscale0: "other", "vEthernet (WSL)": "other",
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(interfaceFamily(name), expected, name);
  assert.equal(windowsAdapterFamily({ alias: "Happ", description: "Wintun Userspace Tunnel", hardware: false, ifType: 53 }), "tun");
  assert.equal(windowsAdapterFamily({ alias: "MyTunnel", description: "WireGuard Tunnel", ifType: 53 }), "wg");
  assert.equal(windowsAdapterFamily({ alias: "Ethernet 3", description: "TAP-Windows Adapter V9", ifType: 6 }), "tap");
  assert.equal(windowsAdapterFamily({ alias: "sing-box", description: "sing-box", ifType: 53 }), "tun", "an unknown virtual point-to-point adapter");
  assert.equal(windowsAdapterFamily({ alias: "Wi-Fi", description: "Intel(R) Wi-Fi 6 AX201 160MHz", hardware: true, ifType: 71 }), "physical");
  assert.equal(windowsAdapterFamily({ alias: "vEthernet (WSL)", description: "Hyper-V Virtual Ethernet Adapter", hardware: false, ifType: 6 }), "other");
});

// ---- macOS parsers ---------------------------------------------------------------

test("macOS: scutil --proxy with a loopback system proxy and a PAC", () => {
  const values = parseScutilProxy(MAC_PROXY_SYSTEM);
  assert.equal(values.HTTPProxy, "127.0.0.1");
  assert.equal(values.ExceptionsList, 4, "only the top-level list is counted");
  assert.equal(describeMacProxy(values), "http=loopback:10808;https=loopback:10808;socks=loopback:10808;pac=loopback;exceptions=4");
  assert.equal(describeMacProxy(parseScutilProxy(MAC_PROXY_CORPORATE)), "http=host;socks=private;pac=host");
  assert.equal(describeMacProxy(parseScutilProxy(MAC_PROXY_OFF)), "off;exceptions=2");
});

test("macOS: scutil --dns with a fake-ip resolver scoped to utun4, and split DNS", () => {
  const tun = parseScutilDns(MAC_DNS_TUN);
  assert.equal(tun.main.length, 3);
  assert.equal(tun.scoped.length, 2);
  assert.deepEqual(tun.main[0].nameservers, ["198.18.0.2"]);
  assert.equal(tun.main[0].ifName, "utun4");
  assert.equal(describeMacDns(tun), "primary=fakeip@utun;split=0;split_ours=0;scoped_tun=1");
  assert.equal(describeMacDns(parseScutilDns(MAC_DNS_SPLIT)), "primary=private@physical;split=2;split_ours=1;scoped_tun=0");
  assert.equal(describeMacDns(parseScutilDns(MAC_DNS_PLAIN)), "primary=private@physical;split=0;split_ours=0;scoped_tun=0");
  assert.equal(describeMacDns(parseScutilDns("")), "primary=none@any;split=0;split_ours=0;scoped_tun=0");
});

test("macOS: route -n get default through utun4, through en0, and with no route", () => {
  assert.deepEqual(parseMacRoute({ stdout: MAC_ROUTE_UTUN }), { name: "utun4" });
  assert.deepEqual(parseMacRoute({ stdout: MAC_ROUTE_EN0 }), { name: "en0" });
  assert.deepEqual(parseMacRoute({ stdout: "", stderr: "route: writing to routing socket: not in table", error: "exit1" }), { name: null });
  assert.equal(parseMacRoute({ stdout: "", error: "timeout" }), undefined, "unknown, not none");
});

test("macOS: ifconfig flags, MTU and addresses", () => {
  const links = parseIfconfig(MAC_IFCONFIG);
  assert.equal(links.get("en0").mtu, 1500);
  assert.equal(links.get("utun4").mtu, 9000);
  assert.equal(links.get("utun4").pointToPoint, true);
  assert.deepEqual(links.get("utun4").addresses, [{ address: "198.18.0.1", v6: false }]);
  assert.deepEqual(links.get("utun5").addresses, []);
  assert.equal(links.get("en0").addresses.length, 3);
});

// ---- Windows parsers -------------------------------------------------------------

test("Windows: Internet Settings, WinHTTP and route print", () => {
  assert.equal(describeWindowsProxy(parseInternetSettings(WINDOWS_REG_SYSTEM), parseWinhttpProxy(WINHTTP_DIRECT)), "all=loopback:10809;pac=loopback;exceptions=7;winhttp=direct");
  assert.equal(describeWindowsProxy(parseInternetSettings(WINDOWS_REG_PER_PROTOCOL), parseWinhttpProxy(WINHTTP_PROXY)), "http=host;https=private;socks=loopback:10808;exceptions=2;winhttp=loopback:10809");
  assert.equal(describeWindowsProxy(parseInternetSettings(WINDOWS_REG_OFF), ""), "off", "a proxy that is set but not enabled is off");
  assert.equal(parseWinhttpProxy(WINHTTP_PROXY_RU), "private");
  assert.deepEqual(parseRoutePrint(WINDOWS_ROUTE_PRINT), { prefix: "0.0.0.0/1", interfaceAddress: "172.19.0.1", metric: 5 }, "the 0/1 + 128/1 pair outranks 0/0");
  assert.deepEqual(parseRoutePrint(WINDOWS_ROUTE_PRINT.replace(/^.*128\.0\.0\.0.*$/gm, "")), { prefix: "0.0.0.0/0", interfaceAddress: "192.168.1.100", metric: 35 });
});

test("Windows: the PowerShell report gives routes, adapter families, MTU and DNS", () => {
  const links = windowsLinks(WINDOWS_REPORT_TUN);
  assert.equal(links.get("Happ").family, "tun");
  assert.equal(links.get("Happ").mtu, 9000);
  assert.equal(links.get("Wi-Fi").family, "physical");
  assert.equal(links.get("vEthernet (WSL)").family, "other");
  assert.equal(links.get("Loopback Pseudo-Interface 1").family, "loopback");
  assert.deepEqual(windowsDefaults(WINDOWS_REPORT_TUN), { v4: { name: "Happ" }, v6: { name: "Wi-Fi" } });
  assert.equal(describeWindowsDns(WINDOWS_REPORT_TUN, links, "Happ"), "primary=private@tun;tun_dns=1");
  assert.equal(describeWindowsDns(WINDOWS_REPORT_TUN, links, "Wi-Fi"), "primary=private+ipv6-linklocal@physical;tun_dns=1");
});

// ---- Linux parsers ---------------------------------------------------------------

test("Linux: ip route, ip link, resolv.conf and GNOME proxy settings", () => {
  assert.deepEqual(parseLinuxRoute({ stdout: LINUX_ROUTE }), { name: "tun0" }, "lowest metric wins");
  assert.deepEqual(parseLinuxRoute({ stdout: "" }), { name: null });
  assert.deepEqual(parseLinuxRoute({ stdout: "93.184.216.34 via 10.8.0.1 dev wg-corp table 51820 src 10.8.0.2 uid 1000 \n    cache \n" }), { name: "wg-corp" });
  const links = parseIpLink(LINUX_LINKS);
  assert.equal(links.get("tun0").family, "tun");
  assert.equal(links.get("wg-corp").family, "wg", "named by the link kind, not by the name");
  assert.equal(links.get("tailscale0").family, "tun");
  assert.equal(links.get("wlp2s0").family, "physical");
  assert.equal(links.get("docker0").family, "other");
  assert.equal(links.get("tun0").mtu, 1420);
  assert.equal(describeResolvConf(LINUX_RESOLV), "primary=loopback;servers=1");
  const gnome = parseGnomeProxy(LINUX_GSETTINGS);
  assert.equal(gnome["http.authentication-password"], undefined, "credentials are never read");
  assert.equal(describeGnomeProxy(gnome), "http=loopback:10808;https=loopback:10808;socks=host;exceptions=3");
  assert.equal(describeGnomeProxy({ mode: "none" }), "off");
  assert.equal(describeGnomeProxy({ mode: "auto", "autoconfig-url": "http://wpad.corp.example.com/wpad.dat" }), "pac=host");
});

test("env and Chromium proxies are described by class", () => {
  assert.equal(describeEnvProxy({ PATH: "/usr/bin", https_proxy: "http://127.0.0.1:7890", ALL_PROXY: "socks5://u:p@127.0.0.1:7891", NO_PROXY: "localhost,127.0.0.1,.corp.example.com", HTTP_PROXY: "" }), "ALL_PROXY=socks5://loopback:7891;https_proxy=http://loopback:7890;NO_PROXY=3");
  assert.equal(describeEnvProxy({ PATH: "/usr/bin" }), "none");
  assert.equal(describeProxyList("PROXY 127.0.0.1:10808; DIRECT"), "PROXY loopback:10808,DIRECT");
  assert.equal(describeProxyList("SOCKS5 127.0.0.1:10808"), "SOCKS5 loopback:10808");
  assert.equal(describeProxyList("HTTPS proxy.corp.example.com:443"), "HTTPS host");
  assert.equal(describeProxyList("DIRECT"), "DIRECT");
});

// ---- Snapshots ------------------------------------------------------------------

test("a Happ-like macOS setup (TUN mode with fake-ip DNS) shows the tunnel", async () => {
  const fields = await macHappDiagnostics().snapshot();
  assert.deepEqual(fields, {
    net_age_s: "0",
    net_default_route: "v4=utun;v6=none;api=utun;tunnel=yes",
    net_tunnels: "utun:fakeip,utun:ipv6-linklocal×2,utun:none",
    net_dns: "primary=fakeip@utun;split=0;split_ours=0;scoped_tun=1",
    net_resolve_api: "fakeip 0ms",
    net_tcp_api: "ok fakeip 0ms",
    net_tls_api: "timeout",
    net_sys_proxy: "off;exceptions=2",
    net_chromium_proxy: "api=DIRECT;gate=DIRECT",
    net_env_proxy: "none",
    net_resolve_gate: "fakeip 0ms",
    net_tcp_gate: "ok fakeip 0ms",
    net_mtu: "v4=9000",
    net_ipv6: "yes:physical",
  });
  assert.ok(Object.keys(fields).length <= 15);
  assert.deepEqual(Object.keys(fields), FIELD_ORDER.filter((key) => key in fields));
});

test("a macOS system-proxy-only setup: routes untouched, Chromium follows a loopback proxy", async () => {
  const diagnostics = createNetworkDiagnostics({
    platform: "darwin",
    env: {},
    execFileImpl: fakeExec({
      "route -n get default": MAC_ROUTE_EN0,
      "route -n get -inet6 default": MAC_ROUTE_EN0,
      "route -n get 203.0.113.10": MAC_ROUTE_EN0,
      ifconfig: MAC_IFCONFIG.replace(/^utun4:[\s\S]*$/m, ""),
      "scutil --proxy": MAC_PROXY_SYSTEM,
      "scutil --dns": MAC_DNS_PLAIN,
    }),
    lookupImpl: fakeLookup({ "api.nextbrowser.com": "ENOTFOUND", "gate.nodemaven.com": [{ address: "203.0.113.20", family: 4 }] }),
    connectImpl: (options) => fakeSocket(options.host === "api.nextbrowser.com" ? { error: "ENOTFOUND" } : { event: "hang" })(),
    tlsConnectImpl: fakeSocket({ error: "ENOTFOUND" }),
    resolveProxyImpl: async (url) => (url.startsWith("https://api.") ? "PROXY 127.0.0.1:10808; DIRECT" : "PROXY 127.0.0.1:10808"),
    networkInterfacesImpl: () => ({ lo0: MAC_INTERFACES.lo0, en0: MAC_INTERFACES.en0, utun0: MAC_INTERFACES.utun0 }),
    timeouts: { connect: 30, total: 500 },
  });
  const fields = await diagnostics.snapshot();
  assert.equal(fields.net_default_route, "v4=physical;v6=physical;tunnel=no");
  assert.equal(fields.net_sys_proxy, "http=loopback:10808;https=loopback:10808;socks=loopback:10808;pac=loopback;exceptions=4");
  assert.equal(fields.net_chromium_proxy, "api=PROXY loopback:10808,DIRECT;gate=PROXY loopback:10808");
  assert.match(fields.net_resolve_api, /^ENOTFOUND \d+ms$/);
  assert.match(fields.net_resolve_gate, /^public \d+ms$/);
  assert.match(fields.net_tcp_api, /^ENOTFOUND \d+ms$/);
  assert.equal(fields.net_tcp_gate, "timeout");
  assert.match(fields.net_tls_api, /^ENOTFOUND \d+ms$/);
  assert.equal(fields.net_tunnels, "utun:ipv6-linklocal×2", "ifconfig also knows the tunnels without an address in the interface list");
  assert.equal(fields.net_mtu, "v4=1500");
});

test("Windows and Linux snapshots use their own sources", async () => {
  const windows = await createNetworkDiagnostics({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", HTTPS_PROXY: "http://127.0.0.1:10809" },
    execFileImpl: fakeExec((key) => {
      if (key.startsWith("powershell.exe")) return JSON.stringify(WINDOWS_REPORT_TUN);
      if (key === "route.exe print -4") return WINDOWS_ROUTE_PRINT;
      if (key.startsWith("reg.exe query")) return WINDOWS_REG_SYSTEM;
      if (key === "netsh.exe winhttp show proxy") return WINHTTP_DIRECT;
      return undefined;
    }),
    lookupImpl: fakeLookup({ "api.nextbrowser.com": [{ address: "198.18.0.7", family: 4 }], "gate.nodemaven.com": [{ address: "198.18.0.8", family: 4 }] }),
    connectImpl: fakeSocket({ event: "connect", remoteAddress: "198.18.0.7" }),
    tlsConnectImpl: fakeSocket({ error: "SELF_SIGNED_CERT_IN_CHAIN" }),
    resolveProxyImpl: async () => "DIRECT",
    networkInterfacesImpl: () => WINDOWS_INTERFACES,
    timeouts: { total: 500 },
  }).snapshot();
  assert.equal(windows.net_default_route, "v4=tun;v6=physical;api=tun;tunnel=yes");
  assert.equal(windows.net_tunnels, "tun:private");
  assert.equal(windows.net_mtu, "v4=9000");
  assert.equal(windows.net_dns, "primary=private@tun;tun_dns=1");
  assert.equal(windows.net_sys_proxy, "all=loopback:10809;pac=loopback;exceptions=7;winhttp=direct");
  assert.equal(windows.net_env_proxy, "HTTPS_PROXY=http://loopback:10809");
  assert.match(windows.net_tls_api, /^SELF_SIGNED_CERT_IN_CHAIN \d+ms$/);
  assert.equal(windows.net_ipv6, "yes:physical");

  // PowerShell missing: route print still names the default route's family.
  const fallback = await createNetworkDiagnostics({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    execFileImpl: fakeExec((key) => (key === "route.exe print -4" ? WINDOWS_ROUTE_PRINT.replace(/^.*128\.0\.0\.0.*$/gm, "") : undefined)),
    lookupImpl: fakeLookup({}),
    connectImpl: fakeSocket({ error: "ECONNREFUSED" }),
    tlsConnectImpl: fakeSocket({ error: "ECONNREFUSED" }),
    networkInterfacesImpl: () => WINDOWS_INTERFACES,
    timeouts: { total: 500 },
  }).snapshot();
  assert.equal(fallback.net_default_route, "v4=physical;v6=?;tunnel=no");
  assert.equal(fallback.net_sys_proxy, "error:ENOENT");
  assert.equal(fallback.net_chromium_proxy, "api=error:UNAVAILABLE;gate=error:UNAVAILABLE");

  const linux = await createNetworkDiagnostics({
    platform: "linux",
    env: {},
    execFileImpl: fakeExec({
      "ip route show default": LINUX_ROUTE,
      "ip -6 route show default": "",
      "ip route get 93.184.216.34": "93.184.216.34 via 10.8.0.1 dev tun0 src 10.8.0.2 uid 1000\n    cache\n",
      "ip -o -d link show": LINUX_LINKS,
      "gsettings list-recursively org.gnome.system.proxy": LINUX_GSETTINGS,
    }),
    readFileImpl: async () => LINUX_RESOLV,
    lookupImpl: fakeLookup({ "api.nextbrowser.com": [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }], "gate.nodemaven.com": "EAI_AGAIN" }),
    connectImpl: fakeSocket({ event: "connect", remoteAddress: "93.184.216.34" }),
    tlsConnectImpl: fakeSocket({ event: "secureConnect" }),
    resolveProxyImpl: async () => "DIRECT",
    networkInterfacesImpl: () => ({ tun0: [{ address: "10.8.0.2", family: "IPv4", internal: false }], wlp2s0: [{ address: "192.168.1.5", family: "IPv4", internal: false }] }),
    timeouts: { total: 500 },
  }).snapshot();
  assert.equal(linux.net_default_route, "v4=tun;v6=none;api=tun;tunnel=yes");
  assert.equal(linux.net_tunnels, "tun:none,tun:private,wg:none");
  assert.equal(linux.net_mtu, "v4=1420");
  assert.equal(linux.net_dns, "primary=loopback;servers=1");
  assert.equal(linux.net_sys_proxy, "http=loopback:10808;https=loopback:10808;socks=host;exceptions=3");
  assert.match(linux.net_resolve_api, /^public\+ipv6-global \d+ms$/);
  assert.match(linux.net_resolve_gate, /^EAI_AGAIN \d+ms$/);
  assert.match(linux.net_tls_api, /^ok \d+ms$/);
});

test("snapshots are cached for a minute and shared by concurrent callers", async () => {
  const time = clock();
  const execCalls = [];
  const lookups = [];
  const diagnostics = createNetworkDiagnostics({
    platform: "darwin",
    env: {},
    execFileImpl: fakeExec(MAC_HAPP_TUN, execCalls),
    lookupImpl: fakeLookup({ "api.nextbrowser.com": [{ address: "198.18.0.7", family: 4 }], "gate.nodemaven.com": [] }, lookups),
    connectImpl: fakeSocket({ event: "connect", remoteAddress: "198.18.0.7" }),
    tlsConnectImpl: fakeSocket({ event: "secureConnect" }),
    resolveProxyImpl: async () => "DIRECT",
    networkInterfacesImpl: () => MAC_INTERFACES,
    now: time.now,
    timeouts: { total: 500 },
  });
  const [first, second] = await Promise.all([diagnostics.snapshot(), diagnostics.snapshot()]);
  assert.deepEqual(first, second);
  assert.equal(lookups.length, 2, "one run for both callers");
  const commands = execCalls.length;
  time.advance(30_000);
  const cached = await diagnostics.snapshot();
  assert.equal(cached.net_age_s, "30");
  assert.equal(lookups.length, 2, "reused within a minute");
  assert.equal(execCalls.length, commands);
  time.advance(31_000);
  const fresh = await diagnostics.snapshot();
  assert.equal(fresh.net_age_s, "0");
  assert.equal(lookups.length, 4, "a new run after a minute");
});

test("a snapshot is bounded in time and never rejects, whatever the probes do", async () => {
  const startedAt = Date.now();
  const hanging = await createNetworkDiagnostics({
    platform: "darwin",
    env: {},
    execFileImpl: fakeExec(() => "hang"),
    lookupImpl: fakeLookup({ "api.nextbrowser.com": "hang", "gate.nodemaven.com": "hang" }),
    connectImpl: fakeSocket({ event: "hang" }),
    tlsConnectImpl: fakeSocket({ event: "hang" }),
    resolveProxyImpl: () => new Promise(() => {}),
    networkInterfacesImpl: () => MAC_INTERFACES,
    timeouts: { total: 300, command: 50, lookup: 50, connect: 50, tls: 50, proxy: 50 },
  }).snapshot();
  assert.ok(Date.now() - startedAt < 1_500, "the run ends within its bound");
  assert.equal(hanging.net_resolve_api, "timeout");
  assert.equal(hanging.net_tcp_api, "timeout");
  assert.equal(hanging.net_tls_api, "timeout");
  assert.equal(hanging.net_chromium_proxy, "api=error:timeout;gate=error:timeout");
  assert.equal(hanging.net_default_route, "v4=?;v6=?;tunnel=no", "unknown, not none");

  const throwing = await createNetworkDiagnostics({
    platform: "linux",
    env: {},
    execFileImpl: () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); },
    lookupImpl: () => { throw new Error("boom"); },
    connectImpl: () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); },
    tlsConnectImpl: () => { throw new Error("boom"); },
    resolveProxyImpl: () => { throw new Error("session not ready"); },
    networkInterfacesImpl: () => { throw new Error("boom"); },
    readFileImpl: async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); },
    timeouts: { total: 300 },
  }).snapshot();
  assert.match(throwing.net_tcp_api, /^EACCES \d+ms$/);
  assert.match(throwing.net_tls_api, /^error \d+ms$/);
  assert.equal(throwing.net_dns, "error:EACCES");
  assert.equal(throwing.net_ipv6, "no");
  assert.equal(throwing.net_chromium_proxy, "api=error:error;gate=error:error");
});

test("no field ever holds an address, a MAC or a host name, even from outputs full of them", async () => {
  const hostile = {
    lookup: [{ address: "203.0.113.77", family: 4 }, { address: "2001:db8:1234::77", family: 6 }],
    names: ["corp.example.com", "proxy.corp.example.com", "wpad.corp.example.com", "socks.corp.example.com", "home.example.lan", "Happ", "sing-box", "Intel", "Wintun", "alice", "hunter2"],
  };
  const env = { HTTP_PROXY: "http://alice:hunter2@proxy.corp.example.com:3128", ALL_PROXY: "socks5://10.9.8.7:1080", NO_PROXY: "corp.example.com,10.0.0.0/8" };
  const common = {
    env: { ...env, SystemRoot: "C:\\Windows" },
    lookupImpl: fakeLookup({ "api.nextbrowser.com": hostile.lookup, "gate.nodemaven.com": hostile.lookup }),
    connectImpl: fakeSocket({ event: "connect", remoteAddress: "203.0.113.77" }),
    tlsConnectImpl: fakeSocket({ error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }),
    resolveProxyImpl: async () => "PROXY proxy.corp.example.com:3128; SOCKS5 10.9.8.7:1080; HTTPS [2001:db8::1]:443; DIRECT",
    timeouts: { total: 500 },
  };
  const snapshots = await Promise.all([
    createNetworkDiagnostics({
      ...common,
      platform: "darwin",
      execFileImpl: fakeExec((key) => {
        if (key.startsWith("route")) return MAC_ROUTE_UTUN;
        if (key === "ifconfig") return MAC_IFCONFIG;
        if (key === "scutil --proxy") return MAC_PROXY_CORPORATE;
        if (key === "scutil --dns") return MAC_DNS_SPLIT;
        return undefined;
      }),
      networkInterfacesImpl: () => MAC_INTERFACES,
    }).snapshot(),
    createNetworkDiagnostics({
      ...common,
      platform: "win32",
      execFileImpl: fakeExec((key) => {
        if (key.startsWith("powershell.exe")) return JSON.stringify(WINDOWS_REPORT_TUN);
        if (key === "route.exe print -4") return WINDOWS_ROUTE_PRINT;
        if (key.startsWith("reg.exe query")) return WINDOWS_REG_PER_PROTOCOL;
        if (key === "netsh.exe winhttp show proxy") return WINHTTP_PROXY_RU;
        return undefined;
      }),
      networkInterfacesImpl: () => WINDOWS_INTERFACES,
    }).snapshot(),
    createNetworkDiagnostics({
      ...common,
      platform: "linux",
      execFileImpl: fakeExec((key) => {
        if (key.startsWith("ip route") || key.startsWith("ip -6 route")) return LINUX_ROUTE;
        if (key === "ip -o -d link show") return LINUX_LINKS;
        if (key.startsWith("gsettings")) return LINUX_GSETTINGS;
        return undefined;
      }),
      readFileImpl: async () => `${LINUX_RESOLV}nameserver 10.0.0.53\nnameserver 2001:db8::53\n`,
      networkInterfacesImpl: () => ({ tun0: [{ address: "10.8.0.2", family: "IPv4", internal: false }], wlp2s0: [{ address: "192.168.1.5", family: "IPv4", internal: false, mac: "3c:22:fb:11:22:33" }] }),
    }).snapshot(),
  ]);
  for (const fields of snapshots) {
    assert.ok(Object.keys(fields).length >= 12, "the probes ran");
    for (const [key, value] of Object.entries(fields)) {
      assert.ok(/^net_[a-z0-9_]+$/.test(key), key);
      assert.ok(value.length <= 200, `${key} is short`);
      assert.doesNotMatch(value, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, `${key} holds no IPv4 address: ${value}`);
      assert.doesNotMatch(value, /(?:[0-9a-f]{1,4}:){2,}|::/i, `${key} holds no IPv6 address or MAC: ${value}`);
      assert.doesNotMatch(value, /[a-z0-9-]+\.[a-z0-9-]+/i, `${key} holds no host name: ${value}`);
      for (const name of hostile.names) assert.ok(!value.toLowerCase().includes(name.toLowerCase()), `${key} does not name ${name}: ${value}`);
    }
  }
});

// ---- Which reports get the diagnostics -----------------------------------------

const envelope = (code, message = "failed", extra = {}) => JSON.stringify({ ok: false, error: { code, message, hint: "", ...extra } });
const nbc = (args, stdout, outcome) => describeNbcResult({ args, result: { code: outcome?.timedOut ? -1 : 1, stdout, stderr: "" }, outcome, durationMs: 1000 }).event;

test("network and proxy reports get the diagnostics; others do not", () => {
  const listed = {
    "nbc network": nbc(["status", "--format", "json"], envelope("REMOTE_BACKEND_ERROR", "Couldn't reach the Nextbrowser service", { network_error: "reset" })),
    "nbc dns": nbc(["profiles", "ls", "--format", "json"], envelope("REMOTE_BACKEND_ERROR", "Couldn't reach the Nextbrowser service", { network_error: "dns" })),
    "nbc REMOTE_BACKEND_ERROR (5xx)": nbc(["status", "--format", "json"], envelope("REMOTE_BACKEND_ERROR", "backend returned 502")),
    "nbc VERIFY_FAILED": nbc(["verify", "--format", "json"], envelope("VERIFY_FAILED", "Browser verification did not pass")),
    "nbc VERIFY_REQUIRED": nbc(["eval", "--format", "json"], envelope("VERIFY_REQUIRED", "VERIFY_REQUIRED: verification is missing")),
    "nbc LAUNCH_FAILED": nbc(["start", "--format", "json"], envelope("LAUNCH_FAILED", "browser exited")),
    "nbc PROXY_*": nbc(["start", "--format", "json"], envelope("PROXY_GATEWAY_UNAVAILABLE", "gateway down")),
    "nbc start timeout": nbc(["start", "--profile", "p", "--format", "json"], "", { timedOut: true }),
    "renderer profile start": { source: "renderer", kind: "command_failed", name: "PROFILE_START_FAILED", context: { surface: "sidebar-profile", code: "PROFILE_START_FAILED" } },
    "agent profile start": describeProfileFailureEvent(describeProfileStartFailure({ profile: "Shop", runtime: "clawbrowser", result: { code: 1, stdout: envelope("LAUNCH_FAILED", "browser exited"), stderr: "" } })).event,
    "manual proxy test": describeInvokeFailure({ command: "manual_proxy_test", error: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }).event,
    "backend timeout": describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", error: new DOMException("timed out", "TimeoutError") }).event,
    "backend reset": describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", error: Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }) }).event,
    "backend lookup": describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", error: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.nextbrowser.com" } }) }).event,
    "backend 5xx": describeBackendRequest({ url: "https://api.nextbrowser.com/v1/x", method: "GET", status: 502 }).event,
  };
  for (const [label, event] of Object.entries(listed)) {
    assert.ok(event, `${label} is reported`);
    assert.equal(wantsNetworkDiagnostics(event), true, label);
  }
  const unlisted = {
    "main exception": { source: "main", kind: "exception", name: "TypeError", context: {} },
    "nbc defect": nbc(["status", "--format", "json"], envelope("INTERNAL_ERROR", "state corrupt")),
    "nbc stop timeout": nbc(["stop", "--format", "json"], "", { timedOut: true }),
    "renderer other": { source: "renderer", kind: "command_failed", name: "AGENT_START_FAILED", context: { surface: "chat", code: "AGENT_START_FAILED" } },
    "other command": describeInvokeFailure({ command: "projects_list", error: new Error("boom") }).event,
    "backend 4xx via command": describeInvokeFailure({ command: "projects_list", error: Object.assign(new Error("conflict"), { status: 409 }) }).event,
  };
  for (const [label, event] of Object.entries(unlisted)) {
    assert.ok(event, `${label} is reported`);
    assert.equal(wantsNetworkDiagnostics(event), false, label);
  }
  assert.equal(wantsNetworkDiagnostics(null), false);
});

function reporterWith(t, { enrich, options } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "net-diag-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const reporter = createClientErrorReporter({
    dir,
    client: { version: "0.2.70", platform: "darwin", arch: "arm64", os_version: "15.1" },
    homeDir: "/Users/alice",
    platform: "darwin",
    resolveEndpoint: async () => ({ baseURL: "https://api.test", apiKey: "" }),
    fetchImpl: async (url, init) => {
      requests.push(JSON.parse(init.body));
      return { status: 202, headers: { get: () => null } };
    },
    setTimer: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; },
    clearTimer: (timer) => clearTimeout(timer),
    enrich,
    options,
  });
  return { reporter, requests };
}

const SNAPSHOT = {
  net_age_s: "0",
  net_default_route: "v4=utun;v6=none;api=utun;tunnel=yes",
  net_tunnels: "utun:fakeip",
  net_dns: "primary=fakeip@utun;split=0;split_ours=0;scoped_tun=1",
  net_resolve_api: "fakeip 2ms",
  net_tcp_api: "ok fakeip 3ms",
  net_tls_api: "timeout",
};

test("the reporter adds the diagnostics before sending, only to the listed reports, within the key limit", async (t) => {
  let snapshots = 0;
  const { reporter, requests } = reporterWith(t, {
    enrich: (event) => {
      if (!wantsNetworkDiagnostics(event)) return undefined;
      snapshots += 1;
      return new Promise((resolve) => setTimeout(() => resolve({ ...SNAPSHOT }), 20));
    },
  });
  const network = nbc(["status", "--format", "json"], envelope("REMOTE_BACKEND_ERROR", "Couldn't reach", { network_error: "dns" }));
  assert.equal(reporter.capture(network), true);
  assert.equal(reporter.capture({ source: "main", kind: "exception", name: "TypeError", message: "boom" }), true);
  // A repeat folds into the first report and asks for nothing new.
  assert.equal(reporter.capture(network), true);
  assert.equal(snapshots, 1);
  await reporter.flush();
  await reporter.flush();
  const events = requests.flatMap((body) => body.events);
  const sentNetwork = events.find((event) => event.kind === "network");
  const sentException = events.find((event) => event.kind === "exception");
  assert.equal(sentNetwork.context.net_default_route, "v4=utun;v6=none;api=utun;tunnel=yes");
  assert.equal(sentNetwork.context.network_error, "dns");
  assert.equal(sentNetwork.context.command, "status");
  assert.equal(Object.keys(sentException.context || {}).some((key) => key.startsWith("net_")), false);

  // Existing keys win, and the fold keys keep their room.
  const crowded = {};
  for (let index = 0; index < 25; index += 1) crowded[`k${index}`] = "v";
  const full = reporterWith(t, { enrich: () => Promise.resolve({ ...SNAPSHOT, k0: "overwritten?" }) });
  full.reporter.capture({ source: "main", kind: "network", name: "ECONNRESET GET /v1/x", message: "reset", context: crowded });
  await full.reporter.flush();
  const [sent] = full.requests[0].events;
  assert.equal(sent.context.k0, "v");
  assert.equal(Object.keys(sent.context).length, 28, "two keys stay free for a folded report");
  assert.deepEqual(Object.keys(sent.context).slice(25), ["net_age_s", "net_default_route", "net_tunnels"]);
});

test("a send waits for slow diagnostics only so long, and failed ones change nothing", async (t) => {
  const slow = reporterWith(t, { enrich: () => new Promise(() => {}), options: { enrichWaitMs: 30 } });
  slow.reporter.capture({ source: "main", kind: "network", name: "ECONNRESET GET /v1/x", message: "reset", context: { method: "GET" } });
  await slow.reporter.flush();
  assert.equal(slow.requests.length, 1);
  assert.deepEqual(slow.requests[0].events[0].context, { method: "GET" });

  const failing = reporterWith(t, { enrich: () => Promise.reject(new Error("probe crashed")) });
  failing.reporter.capture({ source: "main", kind: "network", name: "ECONNRESET GET /v1/x", message: "reset", context: { method: "GET" } });
  await failing.reporter.flush();
  assert.deepEqual(failing.requests[0].events[0].context, { method: "GET" });

  const throwing = reporterWith(t, { enrich: () => { throw new Error("sync failure"); } });
  assert.equal(throwing.reporter.capture({ source: "main", kind: "network", name: "ECONNRESET GET /v1/x", message: "reset" }), true);
});

test("with reporting off nothing is captured, so no probe runs", (t) => {
  let calls = 0;
  const { reporter } = reporterWith(t, { enrich: () => { calls += 1; return Promise.resolve({}); } });
  reporter.setUserEnabled(false);
  assert.equal(reporter.capture({ source: "main", kind: "network", name: "ECONNRESET GET /v1/x", message: "reset" }), false);
  assert.equal(calls, 0);
});
