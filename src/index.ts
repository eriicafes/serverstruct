import { Box, Constructor, factory } from "getbox";
import {
  defineHandler,
  defineMiddleware,
  EventHandlerRequest,
  H3,
  H3Event,
  serve,
} from "h3";

export type ServeOptions = Parameters<typeof serve>[1];

/**
 * Creates an h3 application.
 *
 * @param setup - Function that configures the app. Receives a fresh H3 instance
 *                and Box instance. Can add routes to the provided app, or create
 *                and return a new H3 instance.
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
export function application(
  setup: (app: H3, box: Box) => H3 | void,
  box = new Box()
): {
  app: H3;
  serve: (options?: ServeOptions) => ReturnType<typeof serve>;
} {
  const defaultApp = new H3();
  const app = setup(defaultApp, box) || defaultApp;

  return {
    app,
    serve: (options?: ServeOptions) => serve(app, options),
  };
}

/**
 * Creates an h3 app constructor.
 *
 * @param setup - Function that configures the app.
 * @returns A Constructor that produces an h3 app when resolved via `box.new()`.
 *
 * @example
 * ```typescript
 * import { application, controller } from "serverstruct";
 *
 * class Database {
 *   getUsers() { return ["Alice", "Bob"]; }
 * }
 *
 * // Define a controller
 * const usersController = controller((app, box) => {
 *   const db = box.get(Database);
 *   app.get("/", () => db.getUsers());
 * });
 *
 * // Use it in your app
 * const app = application((app, box) => {
 *   app.mount("/users", box.new(usersController));
 * });
 * ```
 */
export function controller(
  setup: (app: H3, box: Box) => H3 | void
): Constructor<H3> {
  return factory((box) => application(setup, box).app);
}

/**
 * Creates a handler constructor.
 *
 * @param setup - Handler function that receives the event and Box instance.
 * @returns A Constructor that produces a handler when resolved via `box.get()`.
 *
 * @example
 * ```typescript
 * import { application, handler } from "serverstruct";
 *
 * class UserService {
 *   getUser(id: string) { return { id, name: "Alice" }; }
 * }
 *
 * // Define a handler
 * const getUserHandler = handler((event, box) => {
 *   const userService = box.get(UserService);
 *   const id = event.context.params?.id;
 *   return userService.getUser(id);
 * });
 *
 * // Use it in your app
 * const app = application((app, box) => {
 *   app.get("/users/:id", box.get(getUserHandler));
 * });
 * ```
 */
export function handler<
  Res = unknown,
  Req extends EventHandlerRequest = EventHandlerRequest
>(setup: (event: H3Event<Req>, box: Box) => Res) {
  return factory((box) =>
    defineHandler<Req, Res>((event) => setup(event, box))
  );
}

/**
 * Creates a middleware constructor.
 *
 * @param setup - Middleware function that receives the event, next function, and Box instance.
 * @returns A Constructor that produces middleware when resolved via `box.get()`.
 *
 * @example
 * ```typescript
 * import { application, middleware } from "serverstruct";
 *
 * class AuthService {
 *   validateToken(token: string) { return token === "valid"; }
 * }
 *
 * // Define a middleware
 * const authMiddleware = middleware((event, next, box) => {
 *   const authService = box.get(AuthService);
 *   const token = event.headers.get("authorization");
 *   if (!token || !authService.validateToken(token)) {
 *     throw createError({ statusCode: 401, message: "Unauthorized" });
 *   }
 * });
 *
 * // Use it in your app
 * const app = application((app, box) => {
 *   app.use(box.get(authMiddleware));
 *   app.get("/", () => "Hello world!");
 * });
 * ```
 */
export function middleware(
  setup: (
    event: H3Event,
    next: () => unknown | Promise<unknown | undefined>,
    box: Box
  ) => unknown | Promise<unknown | undefined>
) {
  return factory((box) =>
    defineMiddleware((event, next) => setup(event, next, box))
  );
}
