import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ensureNotificationPermissions,
  scheduleErrorsForNextNDays,
  registerNotificationListeners,
  isCapacitorNativePlatform,
  getActiveError,
  setActiveError,
} from "./notifications";
import { auditAppend } from "./audit";
import { runCommand } from "./commands";
import { nativePushEnable, nativePushDisable } from "./push_native";
import { webPushEnable, webPushDisable } from "./push_web";

/**
 * Severity-enabled catalog (analysis only).
 */
const ERROR_CATALOG = [
  // HTTP
  { id: "HTTP 200", type: "HTTP", code: 200, name: "OK", severity: "INFO", fix: "No action required; success path." },
  { id: "HTTP 201", type: "HTTP", code: 201, name: "Created", severity: "INFO", fix: "Client should consume returned resource and/or Location header." },
  { id: "HTTP 204", type: "HTTP", code: 204, name: "No Content", severity: "INFO", fix: "Frontend must not attempt JSON parsing on 204 responses." },
  { id: "HTTP 301", type: "HTTP", code: 301, name: "Moved Permanently", severity: "WARN", fix: "Update frontend router links/API base URL; correct server redirects if misconfigured." },
  { id: "HTTP 302", type: "HTTP", code: 302, name: "Found", severity: "WARN", fix: "Verify redirect logic; for APIs prefer 303/307 if method semantics matter." },
  { id: "HTTP 304", type: "HTTP", code: 304, name: "Not Modified", severity: "INFO", fix: "Validate ETag/If-Modified-Since usage; ensure frontend cache logic handles 304." },
  { id: "HTTP 400", type: "HTTP", code: 400, name: "Bad Request", severity: "WARN", fix: "Validate inputs on both sides; ensure JSON body + Content-Type/Accept headers are correct." },
  { id: "HTTP 401", type: "HTTP", code: 401, name: "Unauthorized", severity: "WARN", fix: "Attach/refresh bearer token; verify backend auth middleware/token verification." },
  { id: "HTTP 403", type: "HTTP", code: 403, name: "Forbidden", severity: "WARN", fix: "Adjust backend roles/permissions; frontend should show authorization error (not generic)." },
  { id: "HTTP 404", type: "HTTP", code: 404, name: "Not Found", severity: "WARN", fix: "Correct router/API paths; add backend route or correct 404 handler." },
  { id: "HTTP 409", type: "HTTP", code: 409, name: "Conflict", severity: "WARN", fix: "Handle uniqueness/version conflicts; implement optimistic locking and return conflict detail." },
  { id: "HTTP 422", type: "HTTP", code: 422, name: "Unprocessable Entity", severity: "WARN", fix: "Return field-level validation errors; map them to UI form validation." },
  { id: "HTTP 429", type: "HTTP", code: 429, name: "Too Many Requests", severity: "WARN", fix: "Implement Retry-After aware backoff; tune server rate limits/throttling." },
  { id: "HTTP 500", type: "HTTP", code: 500, name: "Internal Server Error", severity: "CRITICAL", fix: "Inspect backend logs/tracebacks; add error handling and validation; avoid leaking stack traces." },
  { id: "HTTP 502", type: "HTTP", code: 502, name: "Bad Gateway", severity: "CRITICAL", fix: "Check reverse proxy/upstream health, port mapping, process/container status and routing." },
  { id: "HTTP 503", type: "HTTP", code: 503, name: "Service Unavailable", severity: "CRITICAL", fix: "Scale/restore backend; add health checks; implement graceful restarts; frontend shows maintenance + retry." },
  { id: "HTTP 504", type: "HTTP", code: 504, name: "Gateway Timeout", severity: "CRITICAL", fix: "Optimize slow endpoints/DB queries; increase timeouts or offload long work async." },

  // Windows
  { id: "WIN 2", type: "WIN", code: 2, name: "ERROR_FILE_NOT_FOUND", severity: "WARN", fix: "Verify config paths; ensure files are deployed and accessible." },
  { id: "WIN 3", type: "WIN", code: 3, name: "ERROR_PATH_NOT_FOUND", severity: "WARN", fix: "Create missing directories; verify env vars and working directory." },
  { id: "WIN 5", type: "WIN", code: 5, name: "ERROR_ACCESS_DENIED", severity: "CRITICAL", fix: "Grant required NTFS/registry permissions; run service under appropriate account; avoid protected folders." },
  { id: "WIN 32", type: "WIN", code: 32, name: "ERROR_SHARING_VIOLATION", severity: "WARN", fix: "Close handles; avoid exclusive locks; add retry-with-backoff." },
  { id: "WIN 80", type: "WIN", code: 80, name: "ERROR_FILE_EXISTS", severity: "INFO", fix: "Decide overwrite/append/skip; check existence before create." },
  { id: "WIN 87", type: "WIN", code: 87, name: "ERROR_INVALID_PARAMETER", severity: "WARN", fix: "Validate arguments/flags/paths before calling APIs." },
  { id: "WIN 111", type: "WIN", code: 111, name: "FILENAME_TOO_LONG", severity: "WARN", fix: "Shorten paths; enable long-path support; refactor directory layout." },
  { id: "WIN 487", type: "WIN", code: 487, name: "INVALID_ADDRESS", severity: "CRITICAL", fix: "Investigate native pointer misuse/corruption; patch/upgrade faulty drivers/libs." },

  // POSIX
  { id: "POSIX 2", type: "POSIX", code: 2, name: "ENOENT", severity: "WARN", fix: "Verify path exists; create missing file/dir; correct config paths." },
  { id: "POSIX 5", type: "POSIX", code: 5, name: "EIO", severity: "CRITICAL", fix: "Check disks and logs; retry and monitor storage/hardware." },
  { id: "POSIX 11", type: "POSIX", code: 11, name: "EAGAIN", severity: "INFO", fix: "Use non-blocking I/O with retry/backoff; avoid busy loops." },
  { id: "POSIX 13", type: "POSIX", code: 13, name: "EACCES", severity: "CRITICAL", fix: "Fix permissions/ownership; run service with required rights." },
  { id: "POSIX 17", type: "POSIX", code: 17, name: "EEXIST", severity: "INFO", fix: "Use create-if-not-exists or explicit overwrite logic." },
  { id: "POSIX 28", type: "POSIX", code: 28, name: "ENOSPC", severity: "CRITICAL", fix: "Free space; rotate logs; expand volume; relocate data." },
  { id: "POSIX 111", type: "POSIX", code: 111, name: "ECONNREFUSED", severity: "CRITICAL", fix: "Start target service; open firewall/ports; verify host/port." },
  { id: "POSIX 113", type: "POSIX", code: 113, name: "EHOSTUNREACH", severity: "CRITICAL", fix: "Fix routing/DNS/VPN; verify reachability (ping/traceroute)." },
];

/** Strict OFFLINE indicator */
const HEARTBEAT_URL = "https://r-sys-mgmt.netlify.app/";
const HEARTBEAT_TIMEOUT_MS = 3500;

async function heartbeatOnce() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    await fetch(`${HEARTBEAT_URL}?hb=${Date.now()}`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(t);
    return true;
  } catch {
    clearTimeout(t);
    return false;
  }
}

/** Analyzer (NO timezone/date output) */
function extractCandidates(text) {
  const nums = [...text.matchAll(/\b(\d{2,3})\b/g)].map((m) => Number(m[1]));
  const symbols = [
    ...text.matchAll(/\b(enoent|eacces|eio|eagain|eexist|enospc|econnrefused|ehostunreach)\b/gi),
  ].map((m) => m[1].toUpperCase());

  const hasHttp = /\b(http|status|response)\b/i.test(text);
  const hasWin = /\b(win32|windows|ntfs|registry|error_)\b/i.test(text);
  const hasPosix = /\b(posix|errno|linux)\b/i.test(text);

  return { nums, symbols, hasHttp, hasWin, hasPosix, _text: text };
}

function scoreMatch(entry, ctx) {
  let score = 0;
  if (ctx.nums.includes(entry.code)) score += 5;
  if (ctx.symbols.includes(entry.name)) score += 6;
  if (ctx.hasHttp && entry.type === "HTTP") score += 2;
  if (ctx.hasWin && entry.type === "WIN") score += 2;
  if (ctx.hasPosix && entry.type === "POSIX") score += 2;

  const t = ctx._text || "";
  if (entry.type === "HTTP" && /\b(etag|cache|if-modified-since)\b/i.test(t) && entry.code === 304) score += 2;
  if (entry.type === "HTTP" && /\b(jwt|bearer|token)\b/i.test(t) && entry.code === 401) score += 2;
  if (entry.type === "HTTP" && /\brate limit|retry-after\b/i.test(t) && entry.code === 429) score += 2;

  return score;
}

function analyzeError(input) {
  const raw = input || "";
  const ctx = extractCandidates(raw);

  const ranked = ERROR_CATALOG
    .map((e) => ({ e, s: scoreMatch(e, ctx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);

  if (ranked.length === 0) {
    return ["ANALYSIS: NO_CATALOG_MATCH", "DETAIL: No known signature detected.", "ACTION: Provide numeric code or symbolic errno."].join(
      "\n"
    );
  }

  const lines = [];
  lines.push("ANALYSIS: CATALOG_MATCH");
  lines.push(`INPUT_BYTES: ${new TextEncoder().encode(raw).length}`);
  lines.push(`MATCH_COUNT: ${ranked.length}`);

  ranked.forEach(({ e, s }, i) => {
    lines.push(`\nMATCH[${i}]:`);
    lines.push(`  CLASS: ${e.type}`);
    lines.push(`  CODE: ${e.code}`);
    lines.push(`  NAME: ${e.name}`);
    lines.push(`  SEVERITY: ${e.severity}`);
    lines.push(`  SCORE: ${s}`);
    lines.push(`  FIX: ${e.fix}`);
  });

  lines.push("\nREMEDIATION_PLAN:");
  lines.push("  1. Confirm environment + reproduction steps.");
  lines.push("  2. Apply FIX for highest SCORE match.");
  lines.push("  3. Re-run operation; capture updated logs; verify elimination.");

  return lines.join("\n");
}

/** Clock widget (ONLY place showing date + tz) */
function ClockBadge({ now }) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(now);

  return (
    <div className="clockBadge">
      <div className="clockTime">{time}</div>
      <div className="clockDate">{date}</div>
      <div className="clockTZ">Europe/Rome</div>
    </div>
  );
}

function Terminal({ value, onChange, onSubmit, output }) {
  const outRef = useRef(null);
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [output]);

  return (
    <div className="terminalWrap">
      <div ref={outRef} className="terminalOut">
        {output}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="terminalForm"
      >
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="Paste logs / Type >help" className="terminalInput" />
        <button type="submit" className="terminalBtn">
          RUN
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [activeRestaurant, setActiveRestaurant] = useState("R1");
  const [input, setInput] = useState("");

  const [isOnlineStrict, setIsOnlineStrict] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [activeError, setActiveErrorState] = useState(() => getActiveError());

  // Web Push -> App bridge (PWA)
useEffect(() => {
  if (!("serviceWorker" in navigator)) return;

  const onMsg = (evt) => {
    const msg = evt?.data;
    if (!msg || msg.type !== "SYS_MGMT_PUSH") return;

    // Parse body: "E|I=<uuid>|R=R3|S=CRITICAL|C=HTTP|V=503"
    const body = String(msg.body || "");
    const incidentId = (body.match(/\bI=([0-9a-fA-F-]{36})\b/) || [])[1] || null;
    const restaurant = (body.match(/\bR=(R[1-5])\b/) || [])[1] || null;
    const severity = (body.match(/\bS=(INFO|WARN|CRITICAL)\b/) || [])[1] || null;

    const active = {
      ts: Date.now(),
      title: msg.title || "ERROR",
      body,
      restaurant,
      severity,
      incidentId,
    };

    setActiveError(active);          // persist (your existing storage setter)
    setActiveErrorState(active);     // update UI immediately
    auditAppend({ type: "WEB_PUSH_RECEIVED", ...active });
  };

  navigator.serviceWorker.addEventListener("message", onMsg);
  return () => navigator.serviceWorker.removeEventListener("message", onMsg);
}, []);

  // Sync active error storage
  useEffect(() => {
    const id = setInterval(() => setActiveErrorState(getActiveError()), 1000);
    return () => clearInterval(id);
  }, []);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Terminal content must be ONLY instructions (no date/tz/status)
  const [output, setOutput] = useState(() => ["Paste logs", "Type >help"].join("\n"));

  // Native-only: local notification scheduling + listeners
  useEffect(() => {
    (async () => {
      if (!isCapacitorNativePlatform()) return;
      try {
        await ensureNotificationPermissions();
        await registerNotificationListeners();
        await scheduleErrorsForNextNDays({ nDays: 30, maxPerDay: 2 });
        auditAppend({ type: "LOCAL_NOTIF_INIT_OK" });
      } catch (e) {
        auditAppend({ type: "LOCAL_NOTIF_INIT_ERROR", err: String(e) });
      }
    })();
  }, []);

  // Heartbeat loop: log only on state changes
  useEffect(() => {
    let alive = true;

    const run = async () => {
      const ok = await heartbeatOnce();
      if (!alive) return;

      setIsOnlineStrict((prev) => {
        if (prev !== ok) auditAppend({ type: "NETWORK_CHANGE", network: ok ? "ONLINE" : "OFFLINE" });
        return ok;
      });
    };

    run();
    const id = setInterval(run, 12_000);

    const onFocus = () => run();
    window.addEventListener("focus", onFocus);

    const onBrowserOnline = () => run();
    window.addEventListener("online", onBrowserOnline);

    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onBrowserOnline);
    };
  }, []);

  const platform = isCapacitorNativePlatform() ? "NATIVE" : "PWA";
  const network = isOnlineStrict ? "ONLINE" : "OFFLINE";
  const restaurantLabel = useMemo(() => `RESTAURANT_NODE=${activeRestaurant}`, [activeRestaurant]);

  function clearActiveError() {
    setActiveError(null);
    setActiveErrorState(null);
  }

  // Push enable/disable (command mode)
  const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  async function pushEnable() {
    try {
      const res = isCapacitorNativePlatform() ? await nativePushEnable() : await webPushEnable(VAPID_PUBLIC_KEY);
      auditAppend({ type: "PUSH_ENABLE", platform, result: res });
      return res;
    } catch (e) {
      auditAppend({ type: "PUSH_ENABLE_ERROR", platform, err: String(e) });
      return "PUSH: ERROR";
    }
  }

  async function pushDisable() {
    try {
      const res = isCapacitorNativePlatform() ? await nativePushDisable() : await webPushDisable();
      auditAppend({ type: "PUSH_DISABLE", platform, result: res });
      return res;
    } catch (e) {
      auditAppend({ type: "PUSH_DISABLE_ERROR", platform, err: String(e) });
      return "PUSH: ERROR";
    }
  }

  async function runInput() {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Command mode
    if (trimmed.startsWith(">")) {
      const cmdOut = await runCommand(trimmed, {
        restaurant: activeRestaurant,
        platform,
        network,
        activeError: !!activeError,
        pushEnable,
        pushDisable,
        clearActiveError,
      });

      setOutput((prev) => [prev, "", `CMD: ${trimmed}`, cmdOut].join("\n"));
      setInput("");
      return;
    }

    // Analyze mode (NO date output)
    const analysis = analyzeError(trimmed);

    auditAppend({
      type: "ANALYZE",
      restaurant: activeRestaurant,
      platform,
      network,
      bytes: new TextEncoder().encode(trimmed).length,
      hasActiveError: !!activeError,
      activeErrorRestaurant: activeError?.restaurant || null,
      activeErrorSeverity: activeError?.severity || null,
    });

    setOutput((prev) => {
      return [
        prev,
        "",
        "----------------------------------------",
        `NETWORK: ${network}`,
        restaurantLabel,
        "PAYLOAD:",
        trimmed,
        "",
        "RESULT:",
        analysis,
      ].join("\n");
    });

    setInput("");
    clearActiveError();
  }

  // Top status: show error only when active, else No Error.
  const topStatus = activeError
    ? `${activeError.title || "ERROR"}${activeError.restaurant ? ` (${activeError.restaurant})` : ""}${
        activeError.severity ? ` [${activeError.severity}]` : ""
      }`
    : "No Error";

  return (
    <div className="appRoot">
      <style>{`
        .appRoot { height: 100dvh; background: #0b0b0b; color: #eaeaea; display:flex; flex-direction:column; }

        .top { padding: calc(10px + env(safe-area-inset-top)) 12px 8px 12px; }
        .tabsRow { display:flex; align-items:flex-end; gap: 10px; }
        .tabsScroller { display:flex; gap: 10px; overflow-x:auto; -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
        .tabsScroller::-webkit-scrollbar { height: 6px; }
        .tabsScroller::-webkit-scrollbar-thumb { background: #1f1f1f; border-radius: 999px; }

        .tabBtn { border: 1px solid #222; background:#141414; color:#eaeaea; border-radius: 10px 10px 0 0; padding: 10px 12px; cursor:pointer;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          box-shadow: 0 6px 16px rgba(0,0,0,0.35);
          flex: 0 0 auto;
        }
        .tabBtnActive { background:#0b0b0b; border-bottom: 1px solid #0b0b0b; }

        /* Clock BELOW tabs */
        .clockRow { margin-top: 8px; display:flex; justify-content:center; }
        .clockBadge {
          border: 1px solid #242424;
          background: linear-gradient(180deg, #101010 0%, #070707 100%);
          box-shadow: 0 10px 20px rgba(0,0,0,0.35);
          border-radius: 14px;
          padding: 8px 10px;
          min-width: 240px;
          text-align:right;
          font-family: ui-monospace, monospace;
          color:#eaeaea;
        }
        .clockTime { font-size: 16px; letter-spacing: 0.4px; }
        .clockDate { font-size: 11px; color:#9aa0a6; margin-top: 2px; }
        .clockTZ   { font-size: 10px; color:#7f858a; margin-top: 2px; }

        .statusLine {
          margin-top: 8px;
          font-family: ui-monospace, monospace;
          color:#9aa0a6;
          font-size: 12px;
          padding: 0 2px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap: 10px;
          flex-wrap:wrap;
        }
        .statusLeft { white-space: nowrap; overflow:hidden; text-overflow: ellipsis; max-width: 100%; }
        .statusRight { white-space: nowrap; }

        .bottom { flex:1; display:flex; flex-direction:column; min-height: 0; }
        .terminalWrap { height:100%; display:flex; flex-direction:column; min-height:0; }
        .terminalOut {
          flex:1; overflow:auto; padding: 12px;
          background:#050505; color:#eaeaea;
          border-top: 1px solid #222;
          border-bottom:1px solid #222;
          font-family: ui-monospace, monospace;
          font-size: 13px; white-space: pre-wrap; line-height:1.35;
        }
        .terminalForm { display:flex; gap: 10px; padding: 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background:#0b0b0b; }
        .terminalInput {
          flex:1; min-height: 64px; resize: vertical;
          border:1px solid #2a2a2a; border-radius: 10px; padding: 10px;
          background:#050505; color:#eaeaea; outline:none;
          font-family: ui-monospace, monospace; font-size: 13px;
        }
        .terminalBtn {
          width: 96px; border:1px solid #2a2a2a; border-radius: 10px;
          background:#111; color:#eaeaea; cursor:pointer;
          font-family: ui-monospace, monospace; font-size: 13px;
        }

        @media (max-width: 520px) {
          .clockBadge { width: 100%; min-width: 0; }
          .clockTime { font-size: 14px; }
          .terminalBtn { width: 84px; }
        }
      `}</style>

      {/* TOP */}
      <div className="top">
        <div className="tabsRow">
          <div className="tabsScroller">
            {["R1", "R2", "R3", "R4", "R5"].map((t) => {
              const active = t === activeRestaurant;
              return (
                <button key={t} onClick={() => setActiveRestaurant(t)} className={`tabBtn ${active ? "tabBtnActive" : ""}`}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="clockRow">
          <ClockBadge now={now} />
        </div>

        <div className="statusLine">
          <div className="statusLeft">{topStatus}</div>
          <div className="statusRight">{network}</div>
        </div>
      </div>

      {/* BOTTOM */}
      <div className="bottom">
        <Terminal value={input} onChange={setInput} onSubmit={runInput} output={output} />
      </div>
    </div>
  );
}
