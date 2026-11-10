import { app, type Env } from "./app";

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
