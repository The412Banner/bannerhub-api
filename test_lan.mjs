// Local contract test for the /lan/* room-signaling endpoints, mock KV, no CF.
import worker from "./bannerhub-configs-worker.js";

class MockKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix } = {}) {
    const keys = [...this.m.keys()].filter(x => !prefix || x.startsWith(prefix)).map(name => ({ name }));
    return { keys, list_complete: true };
  }
}
const env = { CONFIG_KV: new MockKV(), AUTH_SECRET: "testsecret", LAN_RELAY_HOST: "relay.example", LAN_RELAY_PORT: "48800" };

let fails = 0;
const check = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

async function call(method, path, body) {
  const init = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { "content-type": "application/json" }; }
  const res = await worker.fetch(new Request("https://w" + path, init), env);
  let j = null; try { j = await res.json(); } catch (e) {}
  return { status: res.status, j };
}

console.log("/lan/* contract:");

// host
let r = await call("POST", "/lan/host", {});
check(r.status === 200 && /^[A-Z0-9]{6}$/.test(r.j.code), "host -> 200 with 6-char code");
check(r.j.role === 1 && r.j.relay === "relay.example" && r.j.port === 48800, "host -> role 1 + relay/port from env");
const code = r.j.code;

// status: waiting
r = await call("GET", "/lan/status?code=" + code);
check(r.status === 200 && r.j.members === 1 && r.j.status === "waiting", "status -> members 1, waiting");

// join
r = await call("POST", "/lan/join", { code });
check(r.status === 200 && r.j.role === 2 && r.j.relay === "relay.example", "join -> role 2 + same relay");

// status: ready
r = await call("GET", "/lan/status?code=" + code);
check(r.status === 200 && r.j.members === 2 && r.j.status === "ready", "status -> members 2, ready");

// third join rejected
r = await call("POST", "/lan/join", { code });
check(r.status === 409, "third join -> 409 room full");

// unknown room
r = await call("POST", "/lan/join", { code: "ZZZZZZ" });
check(r.status === 404, "unknown code -> 404");

// malformed code
r = await call("POST", "/lan/join", { code: "nope" });
check(r.status === 400, "short/garbage code -> 400");

// code normalization: a fresh room joined with lowercase + dashes/spaces
r = await call("POST", "/lan/host", {});
const c2 = r.j.code;
const messy = (c2.slice(0, 3) + "-" + c2.slice(3)).toLowerCase() + " ";
r = await call("POST", "/lan/join", { code: messy });
check(r.status === 200 && r.j.role === 2, "join accepts normalized code (lowercase/dashes/spaces)");

// leave decrements; room becomes waiting again
r = await call("POST", "/lan/leave", { code: c2 });
check(r.status === 200 && r.j.ok === true, "leave -> ok");
r = await call("GET", "/lan/status?code=" + c2);
check(r.status === 200 && r.j.members === 1 && r.j.status === "waiting", "after leave -> members 1, waiting");

// isolation: existing config route still works (unknown method/path unaffected)
r = await call("GET", "/lan/status");
check(r.status === 400, "status without code -> 400 (no crash)");

// ── username tie-in: signed-in host → "Hosted by <name>" ──────────────────────
console.log("/lan/* username tie-in:");
r = await call("POST", "/account/create", { username: "HostGuy", password: "secret6" });
check(r.status === 200 && !!r.j.session, "account create returns a session");
const sess = r.j.session;
r = await call("POST", "/lan/host", { session: sess });
check(r.status === 200 && r.j.host_username === "HostGuy", "host WITH session -> host_username stamped from signed token");
const hc = r.j.code;
r = await call("POST", "/lan/join", { code: hc });
check(r.status === 200 && r.j.host_username === "HostGuy", "join returns host_username");

// no-username case #1: anonymous host (no session)
r = await call("POST", "/lan/host", {});
check(r.status === 200 && (r.j.host_username == null), "anonymous host -> host_username null");
const ac = r.j.code;
r = await call("POST", "/lan/join", { code: ac });
check(r.status === 200 && (r.j.host_username == null), "join on anon room -> host_username null (no 'Hosted by')");

// no-username case #2: a legacy/nameless token (uid only) degrades gracefully
r = await call("POST", "/lan/host", { session: "garbage.token" });
check(r.status === 200 && (r.j.host_username == null), "invalid/nameless session -> anonymous, still hosts fine");

console.log(fails ? `\nFAILED (${fails})` : "\nALL PASS");
process.exit(fails ? 1 : 0);
