import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const deferredChunkGroups: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "deferred-execution",
    ["TerminalDock", "ReviewDock", "DiagnosticsDock", "RuntimeActivityDock"],
  ],
  [
    "deferred-runtime-management",
    [
      "ProviderDock",
      "McpServerDock",
      "PermissionsDock",
      "BackgroundProcessesDock",
      "HooksDock",
      "ModelCatalogDock",
      "WarningsDock",
    ],
  ],
  [
    "deferred-runtime-requests",
    ["ApprovalDock", "RuntimeInputDock", "McpElicitationDock"],
  ],
  [
    "deferred-session-inspection",
    ["SessionHistoryDock", "SubagentsDock", "ContextDock", "GoalDock", "PlanDock"],
  ],
];

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          for (const [chunkName, modules] of deferredChunkGroups) {
            if (modules.some((moduleName) => normalized.includes(`/components/${moduleName}.`))) {
              return chunkName;
            }
          }
          return undefined;
        },
      },
    },
  },
});
