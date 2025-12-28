import { H3, serve } from "h3";
import { Box, Constructor, factory } from "getbox";

export type ServeOptions = Parameters<typeof serve>[1];

/**
 * Creates an h3 application with dependency injection support.
 *
 * @param fn - Function that configures the app. Receives a fresh H3 instance
 *             and Box instance. Can add routes to the provided app, or create
 *             and return a new H3 instance.
 * @param box - Optional Box instance. If not provided, creates a new one.
 * @returns Object with `app` (H3 instance) and `serve` method.
 *
 * @example
 * ```typescript
 * const app = application((app) => {
 *   app.get("/", () => "Hello world!");
 * });
 *
 * await app.serve({ port: 3000 });
 * ```
 *
 * @example With dependency injection
 * ```typescript
 * const app = application((app, box) => {
 *   app.get("/ping", () => "pong");
 *   app.mount("/users", box.new(usersController));
 * });
 *
 * await app.serve({ port: 3000 });
 * ```
 */
export function application(fn: (app: H3, box: Box) => H3 | void, box = new Box()): {
  app: H3;
  serve: (options?: ServeOptions) => ReturnType<typeof serve>;
} {
  const defaultApp = new H3();
  const app = fn(defaultApp, box) || defaultApp;

  return {
    app,
    serve: (options?: ServeOptions) => serve(app, options),
  };
}

/**
 * Creates a Constructor that produces an h3 app when resolved.
 *
 * Use `box.new(controller)` to create fresh controller instances.
 * Controllers can use `box.get()` to access shared dependencies.
 *
 * @param fn - Function that configures the controller.
 * @returns A Constructor that can be resolved via `box.new(controller)`.
 *
 * @example
 * ```typescript
 * // Define a controller
 * const usersController = controller((app, box) => {
 *   app.get("/", () => ["Alice", "Bob"]);
 * });
 *
 * // Use it in your app
 * const app = application((app, box) => {
 *   app.mount("/users", box.new(usersController));
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Controller with shared dependencies
 * class Database {
 *   getUsers() { return ["Alice", "Bob"]; }
 * }
 *
 * const usersController = controller((app, box) => {
 *   const db = box.get(Database);
 *   app.get("/", () => db.getUsers());
 * });
 * ```
 */
export function controller(fn: (app: H3, box: Box) => H3 | void): Constructor<H3> {
  return factory((box) => application(fn, box).app);
}
