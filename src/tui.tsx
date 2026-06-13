/** @jsxImportSource @opentui/solid */
import { createSignal, onMount, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { BusTui } from "@four-bytes/opencode-plugin-lib/tui";
import { ProgressBar } from "@four-bytes/opencode-plugin-lib/tui-components";

const SIDEBAR_ORDER = 42;

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, _props: Record<string, unknown>) {
        return <TokenMeterView />;
      },
    },
  });
};

function TokenMeterView() {
  const [tokens, setTokens] = createSignal(0);
  const [limit, setLimit] = createSignal(50000);
  const [connected, setConnected] = createSignal(false);

  onMount(async () => {
    try {
      const bus = await BusTui.connect(5000);
      setConnected(true);
      
      bus.subscribe("tbg/+/status", (msg) => {
        const p = msg.payload as any;
        if (typeof p.cumulative === "number") {
          setTokens(p.cumulative);
        }
        if (typeof p.hardLimit === "number") {
          setLimit(p.hardLimit);
        }
      });

      onCleanup(() => bus.close());
    } catch {
      setConnected(false);
    }
  });


  return (
    <box flexDirection="column" paddingLeft={0} paddingRight={1} paddingTop={1} paddingBottom={0}>
      <text>
        <b>Tokens 📊</b>
      </text>
      
      {!connected() && (
        <text fg="#888">connecting...</text>
      )}

      {connected() && (
        <ProgressBar
          current={tokens()}
          total={limit()}
          colors={{ green: "#4caf50", orange: "#ff9800", red: "#f44336" }}
        />
      )}
    </box>
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: "four-opencode-token-budget-guard",
  tui,
};
export default plugin;
