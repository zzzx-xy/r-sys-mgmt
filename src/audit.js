const KEY = "sysmgmt_audit_v1";
const MAX = 2000;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX)));
}

export function auditAppend(evt) {
  const arr = load();
  arr.push({
    ts: Date.now(),
    ...evt,
  });
  save(arr);
}

export function auditRead({ tail = 50 } = {}) {
  const arr = load();
  return arr.slice(-Math.max(1, Math.min(500, tail)));
}

export function auditClear() {
  localStorage.removeItem(KEY);
}

export function auditExport() {
  const arr = load();
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
