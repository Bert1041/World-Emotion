/// <reference types="vite/client" />

/** Build-time endpoints for real data, set at deploy (docs/design/phase-6-live-data.md, L1). */
interface ImportMetaEnv {
  readonly VITE_SNAPSHOT_URL?: string;
  readonly VITE_API_URL?: string;
}
