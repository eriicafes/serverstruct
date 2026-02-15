# serverstruct

## 1.2.0

### Minor Changes

- 0031700: Add OpenAPI Integration
- 0031700: Add OpenTelemetry Integration
- 0031700: Rexport `serve` function H3

## 1.1.0

### Minor Changes

- 2d657d5: Add `handler`, `eventHandler` and `middleware` functions

  Add request-scoped `Context` with the `context` function.

## 1.0.0

### Major Changes

- 78a41c4: Release v1

## 0.4.0

### Minor Changes

- 84d056e: Migrate from `hono` and `hollywood-di` to `h3` and `getbox`.

  Replace `createModule()` with `application(fn, box?)` and `controller(fn)`.

## 0.3.0

### Minor Changes

- bffca37: Rename createRoute to createModule

### Patch Changes

- 7322c66: Update dependencies

## 0.2.0

### Minor Changes

- fa4e3da: Replace createController/createModule API with createRoute

## 0.1.1

### Patch Changes

- 609146c: Bump CI node version to v18
