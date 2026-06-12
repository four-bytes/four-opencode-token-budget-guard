/** @jsxImportSource @opentui/solid */
import { createSignal, onMount, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { BusTui } from "@four-bytes/opencode-plugin-lib/tui";

interface TokenStatus {
  sessionID: string;
  cumulative: number;
  softLimit: number;
  hardLimit: number;
  percentage: number;
  status: string;
}

const SIDEBAR_ORDER = 42;

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props: Record<string, unknown>) {
        return <TokenMeterView api={api} sessionId={props.session_id as string} />;
      },
    },
  });
};

function TokenMeterView(_props: { api: TuiPluginApi; sessionId: string }) {
  const [status, setStatus] = createSignal<TokenStatus | null>(null);
  const [busStatus, setBusStatus] = createSignal<"connecting" | "connected" | "disconnected">("connecting");
  const [hidden, setHidden] = createSignal(false);
  let bus: BusTui | null = null;
  let unsub: (() => void) | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    try {
      bus = await BusTui.connect(3000);
      setBusStatus("connected");

      unsub = bus.subscribe("tbg/+/status", (msg) => {
        setStatus(msg.payload as TokenStatus);
      });
    } catch {
      setBusStatus("disconnected");
      // Hide after 3 seconds if no bus
      hideTimer = setTimeout(() => setHidden(true), 3000);
    }
  });

  onCleanup(() => {
    if (unsub) unsub();
    if (bus) bus.close();
    if (hideTimer) clearTimeout(hideTimer);
  });

  // ── Render ──
  if (hidden()) return null;

  const s = status();
  const pct = s?.percentage ?? 0;
  const barColor = pct < 50 ? "#4caf50" : pct < 80 ? "#ff9800" : "#f44336";

  return (
      <box width="100%" flexDirection="column" paddingX={1} paddingY={1}>
      <text>
        <b>Token Budget</b>
      </text>

      {busStatus() === "connecting" && (
        <text fg="#888">connecting to bus...</text>
      )}

      {busStatus() === "disconnected" && !s && (
        <text fg="#888">plugin bus not available</text>
      )}

      {busStatus() === "connected" && !s && (
        <text fg="#888">waiting for session...</text>
      )}

      {s && (
        <>
          {/* Progress bar track */}
          <box height={1} width="100%" backgroundColor="#333" marginY={1}>
            {/* Progress bar fill */}
            <box
              height={1}
              width={`${Math.min(pct, 100)}%`}
              backgroundColor={barColor}
            />
          </box>

          {/* Stats row */}
          <box width="100%" flexDirection="row" justifyContent="space-between">
            <text>
              {s.cumulative.toLocaleString()} / {s.softLimit.toLocaleString()}
            </text>
            <text fg={barColor}>{pct}%</text>
          </box>
          <text fg="#888">
            {s.status === "below_soft"
              ? "within budget"
              : s.status === "soft_exceeded"
                ? "soft limit exceeded"
                : "hard limit exceeded"}
          </text>
        </>
      )}
    </box>
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: "four-opencode-token-budget-guard",
  tui,
};
export default plugin;
