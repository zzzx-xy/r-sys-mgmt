import { auditAppend, auditRead, auditClear, auditExport } from "./audit";

export async function runCommand(cmdLine, ctx) {
  const line = (cmdLine || "").trim().replace(/^>\s*/, "");
  const [cmdRaw, ...args] = line.split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();

  auditAppend({
    type: "COMMAND",
    cmd: cmdRaw || "",
    args,
    restaurant: ctx.restaurant,
    network: ctx.network,
    platform: ctx.platform,
  });

  switch (cmd) {
    case "help":
      return [
        "COMMANDS:",
        "  >help",
        "  >status",
        "  >push enable",
        "  >push disable",
        "  >audit tail [N]",
        "  >audit export",
        "  >audit clear",
        "  >error clear",
      ].join("\n");

    case "status":
      // NO date, NO timezone
      return [
        "STATUS:",
        `  RESTAURANT_NODE=${ctx.restaurant}`,
        `  NETWORK=${ctx.network}`,
        `  PLATFORM=${ctx.platform}`,
        `  ACTIVE_ERROR=${ctx.activeError ? "1" : "0"}`,
      ].join("\n");

    case "push": {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "enable") return await ctx.pushEnable();
      if (sub === "disable") return await ctx.pushDisable();
      return "PUSH: INVALID_SUBCOMMAND";
    }

    case "audit": {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "tail") {
        const n = Number(args[1] || 50);
        const rows = auditRead({ tail: n });
        return rows.length ? rows.map((r) => JSON.stringify(r)).join("\n") : "AUDIT: EMPTY";
      }
      if (sub === "export") {
        auditExport();
        return "AUDIT: EXPORT_TRIGGERED";
      }
      if (sub === "clear") {
        auditClear();
        return "AUDIT: CLEARED";
      }
      return "AUDIT: INVALID_SUBCOMMAND";
    }

    case "error": {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "clear") {
        ctx.clearActiveError();
        auditAppend({ type: "ERROR_CLEARED", restaurant: ctx.restaurant });
        return "ERROR: CLEARED";
      }
      return "ERROR: INVALID_SUBCOMMAND";
    }

    default:
      return "COMMAND: UNKNOWN (use >help)";
  }
}
