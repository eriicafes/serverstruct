---
name: create-serverstruct
description: Use when bootstrapping a new serverstruct application or maintaining an application that follows the create-serverstruct conventions.
---

# Create Serverstruct

Use one opinionated structure from the first route onward so the application can grow without changing its boundaries or naming.

## Read the Relevant Reference

- For a new application or changes to root setup, read [references/bootstrap.md](references/bootstrap.md) completely.
- For domain modules, controllers, services, middleware, or controller tests, read [references/modules.md](references/modules.md) completely.
- A new application needs both references. Do not load the bootstrap reference for an ordinary module change.

When maintaining an existing application, preserve its package manager, build tool, test runner, and established import alias.

## Setup Decisions

Before bootstrapping:

1. Inspect the repository's package configuration, TypeScript configuration, source tree, and test setup.
2. Ask the user once: **Should this server include OpenTelemetry tracing?**
3. Confirm that the target runtime supports the preferred dependency pattern below.

Every application includes OpenAPI. Create the root shell plus one complete domain module and its HTTP test; do not generate empty feature directories.

## Application Layout

Use the root names `main.ts`, `app.ts`, and `config.ts` exactly. Do not replace them with `index.ts`, `server.ts`, or `env.ts`.

```text
src/
├── main.ts
├── app.ts
├── config.ts
├── instrumentation.ts         # only when OpenTelemetry is selected
├── errors.ts                  # errors shared across domains, when needed
├── lib/                       # external libraries configured for app-wide use
├── middlewares/               # reusable request policies
├── services/                  # behavior genuinely shared across domains
└── modules/
    └── users/
        ├── controller.ts
        ├── controller.test.ts
        ├── module.ts
        └── service.ts
```

Root responsibilities:

- `main.ts` owns the Box scope, process startup, `serve()`, graceful shutdown, and process-level resources. It contains no routes.
- `app.ts` owns global middleware order, raw compatibility handlers, top-level controller mounts, and the OpenAPI document.
- `config.ts` exports `AppConfig` and is the only application file that reads `process.env`.
- `errors.ts` contains only errors shared across domain boundaries.

## Dependency Injection

Prefer `withBox()` and `inject()` from `getbox/context`. Open one `withBox()` scope in `main.ts`; use `inject()` in that process scope and in class-backed services.

Controllers and factories receive a `box` argument. Resolve their dependencies with `box.get(...)`; never call `inject()` inside `factory()`. Resolve controller dependencies once during setup and close over them in handlers.

If the target runtime is not a reliable fit for AsyncLocalStorage, use explicit constructor injection with `Box.init` consistently. Do not mix class-injection styles within one application.

## Configuration

`AppConfig` has two public groups:

- `env` contains deployment-controlled values parsed once from `process.env` by a private Zod schema.
- `vars` contains fixed application identity and compile-time constants declared inline with `as const`.

Load environment variables through the deployment platform or process launcher before constructing `AppConfig`. Consumers resolve `AppConfig` and read values such as `config.env.PORT` and `config.vars.APP_NAME`.

## App-wide External Libraries

Put an integration in `lib/` when it configures an external library once for application-wide use. Name the file after the capability it provides, such as `database.ts`, `logger.ts`, `auth.ts`, `mail.ts`, `cache.ts`, or `storage.ts`.

A `lib/` file imports and configures the package, resolves dependencies from its factory `box`, and exports a PascalCase Box constructor such as `Database`, `Logger`, or `Auth`. Consumers resolve that constructor rather than configuring the package again.

Keep domain behavior in its module, reusable request policies in `middlewares/`, and integrations used by only one domain inside that domain. `main.ts` starts and closes process-level resources exposed by configured libraries.

## Domain Modules

Every route-bearing domain uses these primary files:

- `controller.ts` owns OpenAPI contracts, request parsing, request policy checks, service orchestration, HTTP error mapping, response transforms, and child mounts.
- `module.ts` owns reusable public models and domain-specific errors. It is not a barrel file.
- `service.ts` owns the domain's service methods, persistence access, and domain decisions. It does not import H3 or construct HTTP responses.
- `controller.test.ts` exercises the domain through HTTP with its real controller and service boundary.

Free-standing functions should not exist in domain modules. Put behavior on the class that owns it and use private methods for internal steps.

Keep one `module.ts` per domain directory. A substantial sibling resource uses paired names such as `sessions.controller.ts`, `sessions.controller.test.ts`, and `sessions.service.ts`; give it a nested directory only when it owns models or children of its own.

Export service input and output types beside the service when another module or test needs them. Services never import controller schemas.

## Naming

| Concern                       | Convention                                 | Example                                           |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------- |
| Root controller               | PascalCase `App` or `<Name>App`            | `App`                                             |
| Primary controller            | singular Pascal `<Domain>Controller`       | `UserController`                                  |
| Sibling controller file/value | plural resource file, singular owner value | `sessions.controller.ts`, `UserSessionController` |
| Service class                 | singular Pascal `<Domain>Service`          | `UserService`                                     |
| Reusable model class          | singular Pascal `<Domain>Models`           | `UserModels`                                      |
| Endpoint schema class         | singular Pascal `<Domain>Schemas`          | `UserSchemas`                                     |
| Response mapper               | singular Pascal `<Domain>DTO`              | `UserDTO`                                         |
| App-wide integration          | PascalCase capability noun                 | `Database`, `Logger`, `Auth`                      |
| Middleware constructor        | PascalCase `<Policy>Middleware`            | `AuthMiddleware`                                  |
| Request context               | lower camel `<subject>Ctx`                 | `authCtx`, `requestMetaCtx`                       |
| Operation ID                  | verb first, then resource                  | `getUser`, `listUsers`                            |
| Route path                    | plural resource nouns                      | `/users/:userId/sessions`                         |

Name every getbox constructor in PascalCase, whether it is a class or a value created by `controller()`, `handler()`, `eventHandler()`, `route()`, `factory()`, `middleware()`, `computed()`, or `constant()`. Any value passed to `box.get()`, `inject()`, or `router.mount(box, ...)` follows this rule. Inside `box.get({ ... })`, keep dependency properties lower camel and semantic, such as `users: UserService`, `authMiddleware: AuthMiddleware`, and `logger: Logger`. Do not use vague property names such as `service`, `manager`, `helper`, or `handler`.

Use relative imports within a module and one `#/*` alias for cross-directory imports.

## Controllers and OpenAPI

Keep controller files in this order:

1. Imports.
2. One exported `<Domain>Schemas` class.
3. One unexported `<Domain>DTO` class when mapping is needed.
4. The exported `<Domain>Controller`.

Inside the controller closure:

1. Resolve one `deps` object with `box.get({ ... })`.
2. Construct the DTO.
3. Apply module middleware in execution order.
4. Call `useRouter(app)` once.
5. Declare routes grouped by resource.
6. Mount child controllers last.

After `useRouter(app)`, register routes and mounts through `router`, not `app`. Register raw third-party H3 handlers before creating the router. Keep routes inline; extract `route()` only for actual reuse.

Every route is documented. Its static schema member name matches its verb-first `operationId`, and its operation provides tags, summary, request schemas, and every expected response. Parse inputs only through `ctx.params`, `ctx.query`, and `ctx.body`.

Use `{ data: ... }` for non-empty successes, no body for `204`, and top-level `message` plus optional `errors` for failures. Use `ctx.reply` for typed responses and `ctx.validReply` only when runtime response validation is needed.

Reusable entity schemas belong on `<Domain>Models`. Keep endpoint-only bodies, wrappers, and aggregates in the route's `schemas()` member.

DTO inputs use the actual database or internal type returned by the service, never an inline approximation. DTO methods construct the public object explicitly rather than parsing it through a response schema.

## Route Handler Layout

Keep request reads together at the top with no blank lines between them, in this order:

1. `params`
2. `query`
3. `body`
4. request contexts in a stable application-wide order

Keep `params`, `query`, and `body` as whole parsed objects. Name contexts after their contents, such as `session` or `requestMeta`, and service outputs after their domain value, such as `user`, `users`, or `updatedUser`. Reserve `data` for response envelopes and `response` or `res` for HTTP responses in tests.

Place one blank line after the request-read block. Then arrange derived values, guards, service calls, failure handling, and the response in their natural dependency order, using further blank lines only where they make those phases easier to scan.

## Middleware and Request Context

Extract reusable request policies as PascalCase middleware constructors and resolve their dependencies from `box`. Use serverstruct `context()` for typed request-scoped state: middleware sets it once, controllers read it, and services receive required values as ordinary arguments.

Do not store request state in mutable module globals or make services parse HTTP events.

## Tests

Keep `controller.test.ts` beside the controller and test through `app.request()` so routing, middleware, validation, error mapping, and serialization run together. Resolve the controller and supporting services from one Box at `describe` scope, outside `it` blocks.

Mock remote APIs, mail, queues, clocks, and other external boundaries. Prefer the real domain service with disposable persistence when proving the complete local path. Keep sibling tests independent.

## Finish

Before completing the change:

- type-check and run the changed controller tests
- confirm `/docs` loads and includes every changed route
- close every process-level resource during shutdown, including telemetry when selected
