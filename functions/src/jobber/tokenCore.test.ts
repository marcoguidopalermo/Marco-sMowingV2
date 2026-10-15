/* eslint-disable max-len, valid-jsdoc */
// The Jobber token refresh rules.
//   npm test -- tokenCore
import {test} from "vitest";
import assert from "node:assert/strict";
import {
  DISCONNECTED_LOG, getAccessToken, JobberDisconnectedError, JobberNotConnectedError,
  LEASE_MS, REFRESH_BUFFER_MS, StoredTokens, TokenDeps,
} from "./tokenCore";

/**
 * A fake world: a virtual clock, one token document, one lease document and
 * a Jobber that rotates refresh tokens and refuses any token used twice —
 * exactly the behaviour that disconnected us.
 */
function world(opts: {expiresInMs: number; jobberLatencyMs?: number}) {
  let clock = 1_000_000;
  let n = 0;
  const live = new Set<string>(["r0"]); // refresh tokens Jobber accepts
  const state = {
    tokens: {accessToken: "a0", refreshToken: "r0", accessTokenExpiresAt: clock + opts.expiresInMs} as StoredTokens | null,
    lease: null as null | {holder: string; leaseUntil: number},
    posts: 0, rejectedPosts: 0, disconnected: 0, logs: [] as string[],
  };
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const deps: TokenDeps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms; await tick();
    },
    readTokens: async () => {
      await tick(); return state.tokens ? {...state.tokens} : null;
    },
    tryAcquireLease: async (holder, until) => {
      await tick();
      if (state.lease && state.lease.leaseUntil > clock && state.lease.holder !== holder) return false;
      state.lease = {holder, leaseUntil: until}; return true;
    },
    releaseLease: async (holder) => {
      await tick(); if (state.lease?.holder === holder) state.lease = null;
    },
    postRefresh: async (rt) => {
      state.posts++;
      clock += opts.jobberLatencyMs ?? 300; await tick();
      if (!live.has(rt)) {
        // Reuse of a spent refresh token: revoke the whole family (what OAuth
        // servers with rotation do) — the connection is now dead for everyone.
        state.rejectedPosts++; live.clear();
        return {ok: false, rejected: true, status: 401, message: "The provided refresh token is not valid."};
      }
      live.delete(rt); n++;
      const next = `r${n}`; live.add(next);
      return {ok: true, accessToken: `a${n}`, refreshToken: next, expiresInSec: 3600};
    },
    saveTokens: async (t) => {
      await tick(); state.tokens = {...t};
    },
    markDisconnected: async () => {
      state.disconnected++;
    },
    log: {info: () => undefined, warn: () => undefined, error: (m) => state.logs.push(m)},
  };
  return {deps, state, live, advance: (ms: number) => (clock += ms)};
}

console.log("\nNormal use");
test("a fresh token is returned with no refresh and no lease", async () => {
  const w = world({expiresInMs: 30 * 60e3});
  assert.equal(await getAccessToken(w.deps, {holder: "h1"}), "a0");
  assert.equal(w.state.posts, 0);
  assert.equal(w.state.lease, null);
});

test("inside the 5-minute buffer → one refresh, new pair saved, lease released", async () => {
  const w = world({expiresInMs: REFRESH_BUFFER_MS - 1});
  assert.equal(await getAccessToken(w.deps, {holder: "h1"}), "a1");
  assert.equal(w.state.posts, 1);
  assert.equal(w.state.tokens?.refreshToken, "r1");
  assert.equal(w.state.lease, null);
});

console.log("\nTHE INCIDENT CLASS: several functions need a token at once");
test("8 concurrent callers with an expiring token → exactly ONE refresh, all get the new token", async () => {
  const w = world({expiresInMs: 1000, jobberLatencyMs: 800});
  const got = await Promise.all(Array.from({length: 8}, (_, i) => getAccessToken(w.deps, {holder: `h${i}`})));
  assert.equal(w.state.posts, 1);
  assert.equal(w.state.rejectedPosts, 0);
  assert.deepEqual([...new Set(got)], ["a1"]);
  assert.equal(w.state.disconnected, 0);
  assert.ok(w.live.has("r1"), "the connection is still alive afterwards");
});

test("WITHOUT the lease the same race kills the connection (proves the test bites)", async () => {
  const w = world({expiresInMs: 1000, jobberLatencyMs: 800});
  w.deps.tryAcquireLease = async () => true; // everyone "holds" it
  await Promise.allSettled(Array.from({length: 4}, (_, i) => getAccessToken(w.deps, {holder: `h${i}`})));
  assert.ok(w.state.posts > 1);
  assert.ok(w.state.rejectedPosts > 0);
  assert.equal(w.live.size, 0, "every refresh token revoked — the next refresh would fail");
});

console.log("\n401 handling");
test("a 401 on a token that's already been replaced → no refresh, the new token", async () => {
  const w = world({expiresInMs: 30 * 60e3});
  w.state.tokens = {accessToken: "a7", refreshToken: "r0", accessTokenExpiresAt: w.deps.now() + 30 * 60e3};
  assert.equal(await getAccessToken(w.deps, {holder: "h1", rejectedToken: "a6"}), "a7");
  assert.equal(w.state.posts, 0);
});
test("a 401 on the current token → refresh even though it isn't expired", async () => {
  const w = world({expiresInMs: 30 * 60e3});
  assert.equal(await getAccessToken(w.deps, {holder: "h1", rejectedToken: "a0"}), "a1");
  assert.equal(w.state.posts, 1);
});
test("several 401s on the same token at once → one refresh", async () => {
  const w = world({expiresInMs: 30 * 60e3, jobberLatencyMs: 500});
  const got = await Promise.all([1, 2, 3].map((i) => getAccessToken(w.deps, {holder: `h${i}`, rejectedToken: "a0"})));
  assert.equal(w.state.posts, 1);
  assert.deepEqual([...new Set(got)], ["a1"]);
});

console.log("\nCrashes and disconnects");
test("a holder that died with the lease: others take over once it expires", async () => {
  const w = world({expiresInMs: 1000});
  w.state.lease = {holder: "dead", leaseUntil: w.deps.now() + LEASE_MS};
  assert.equal(await getAccessToken(w.deps, {holder: "h1"}), "a1");
  assert.equal(w.state.posts, 1);
});

test("Jobber refuses the refresh token → alert log line, marked disconnected, clear error", async () => {
  const w = world({expiresInMs: 1000});
  w.live.clear(); // e.g. GraphiQL replaced our authorization
  await assert.rejects(getAccessToken(w.deps, {holder: "h1"}), JobberDisconnectedError);
  assert.deepEqual(w.state.logs, [DISCONNECTED_LOG]);
  assert.equal(w.state.disconnected, 1);
  assert.equal(w.state.lease, null);
});

test("refused, but an admin reconnected meanwhile → use the new connection, no alert", async () => {
  const w = world({expiresInMs: 1000});
  w.live.clear();
  const orig = w.deps.postRefresh;
  w.deps.postRefresh = async (rt) => {
    const r = await orig(rt);
    w.state.tokens = {accessToken: "fresh", refreshToken: "rNew", accessTokenExpiresAt: w.deps.now() + 3600e3};
    return r;
  };
  assert.equal(await getAccessToken(w.deps, {holder: "h1"}), "fresh");
  assert.deepEqual(w.state.logs, []);
  assert.equal(w.state.disconnected, 0);
});

test("a network error is NOT reported as a disconnect", async () => {
  const w = world({expiresInMs: 1000});
  w.deps.postRefresh = async () => ({ok: false, rejected: false, status: 503, message: "unavailable"});
  await assert.rejects(getAccessToken(w.deps, {holder: "h1"}), /503/);
  assert.deepEqual(w.state.logs, []);
  assert.equal(w.state.disconnected, 0);
});

test("never connected → JobberNotConnectedError", async () => {
  const w = world({expiresInMs: 1000});
  w.state.tokens = null;
  await assert.rejects(getAccessToken(w.deps, {holder: "h1"}), JobberNotConnectedError);
});

test("a refreshed pair that can't be saved is retried, then surfaces (never silently lost)", async () => {
  const w = world({expiresInMs: 1000});
  let fails = 2;
  const orig = w.deps.saveTokens;
  w.deps.saveTokens = async (t, at) => {
    if (fails-- > 0) throw new Error("write failed"); return orig(t, at);
  };
  assert.equal(await getAccessToken(w.deps, {holder: "h1"}), "a1");
  assert.equal(w.state.tokens?.refreshToken, "r1");
});
