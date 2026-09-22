# Bootstrap Reference

Read this file completely when creating a serverstruct application or changing its root setup.

## Dependencies and TypeScript

Install the core runtime dependencies with the repository's package manager:

```sh
pnpm add serverstruct h3 getbox zod zod-openapi
```

Use ESM and strict TypeScript. This complete `tsconfig.json` assumes a bundler handles production output:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["node"],
    "rootDir": "./src",
    "outDir": "./dist",
    "paths": {
      "#/*": ["./src/*"]
    },
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "moduleDetection": "force",
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

`moduleDetection: "force"` treats every implementation file as a module, including files with no imports or exports. This prevents declarations from leaking into a shared global script scope and keeps isolated compilation predictable. It does not choose the runtime module format; `module`, the build output, and the package's `type` field do that.

## `config.ts`

Load environment variables through the deployment platform or process launcher before constructing `AppConfig`. For local development:

```sh
node --env-file=.env --import tsx src/main.ts
```

```typescript
import { z } from "zod";

export class AppConfig {
  readonly env: z.infer<typeof AppConfig.schema>;
  readonly vars = {
    APP_ID: "accounts-api",
    APP_NAME: "Accounts API",
    APP_VERSION: "0.1.0",
  } as const;

  constructor() {
    this.env = AppConfig.schema.parse(process.env);
  }

  private static schema = z.object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  });
}
```

## `main.ts`

```typescript
import { inject, withBox } from "getbox/context";
import { serve } from "serverstruct";
import { App } from "./app";
import { AppConfig } from "./config";

withBox(async () => {
  const [app, config] = inject([App, AppConfig]);
  const server = serve(app, { port: config.env.PORT });

  const shutdown = async () => {
    await server.close(true);
    process.exit(0);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
});
```

## `app.ts`

Register any raw third-party H3 handler before `useRouter(app)`. Use the router for every route and mount after that point.

```typescript
import { controller } from "serverstruct";
import { useRouter } from "serverstruct/openapi";
import { AppConfig } from "./config";
import { HealthController } from "./modules/health/controller";
import { UserController } from "./modules/users/controller";

export const App = controller((app, box) => {
  const deps = box.get({ config: AppConfig });
  const router = useRouter(app);

  router.mount(box, {
    "/health": HealthController,
    "/users": UserController,
  });

  router.document("/docs", {
    openapi: "3.1.0",
    info: {
      title: deps.config.vars.APP_NAME,
      version: deps.config.vars.APP_VERSION,
    },
    tags: [
      { name: "Health", description: "Check that the server is running." },
      { name: "Users", description: "Manage user accounts." },
    ],
  });
});
```

The document and Scalar reference are available at `/docs` and `/docs/reference`. Keep document metadata, security schemes, and tags synchronized with mounted controllers.

## `lib/` Example

Factories resolve dependencies from their `box`; they never call `inject()`.

```typescript
// lib/logger.ts
import { AppConfig } from "#/config";
import { factory } from "getbox";
import pino from "pino";

export const Logger = factory((box) => {
  const config = box.get(AppConfig);

  return pino({
    level: config.env.LOG_LEVEL,
    base: {
      service: config.vars.APP_ID,
      version: config.vars.APP_VERSION,
    },
  });
});
```

## OpenTelemetry

Only add this setup when the user selects OpenTelemetry. Install the relevant SDK and exporter packages, create `src/instrumentation.ts`, preload it before `main.ts`, apply `traceMiddleware()` after the outer error middleware, and shut down telemetry with the server.

```typescript
// instrumentation.ts
import { NodeSDK } from "@opentelemetry/sdk-node";

export const telemetry = new NodeSDK();
telemetry.start();
```

```json
{
  "scripts": {
    "start": "node --import ./dist/instrumentation.js ./dist/main.js"
  }
}
```

```typescript
// app.ts, before useRouter(app)
app.use(errorMiddleware);
app.use(traceMiddleware());
```

```typescript
// main.ts, inside shutdown
await server.close(true);
await telemetry.shutdown();
```

When OpenTelemetry is not selected, do not add its dependencies, file, configuration fields, middleware, or shutdown calls.
