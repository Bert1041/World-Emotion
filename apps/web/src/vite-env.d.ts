/// <reference types="vite/client" />

/** Build-time endpoints for real data, set at deploy (docs/design/phase-6-live-data.md, L1). */
interface ImportMetaEnv {
  readonly VITE_SNAPSHOT_URL?: string;
  readonly VITE_API_URL?: string;
  /** Phase 6.5: the look a build starts in when the URL does not say ("next" for QA runs). */
  readonly VITE_LOOK?: string;
}
