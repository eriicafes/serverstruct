import { Box, Constructor, transient } from "getbox";
import {
  defineHandler,
  defineMiddleware,
  EventHandlerObject,
  EventHandlerRequest,
  H3,
  H3Event,
  Middleware,
  serve,
} from "h3";

export { serve } from "h3";

export type Server = ReturnType<typeof serve>;
export type ServeOptions = Parameters<typeof serve>[1];

type MaybePromise<T = unknown> = T | Promise<T>;

/**
 * Creates an H3 application.
 *
 * @param setup - Function that configures the app. Receives a fresh H3 instance
 *                and Box instance. Can add routes to the provided app, or create
 *                and return a new H3 instance.
 * @param box - Optional Box instance. If not provided, creates a new one.
 * @returns H3 instance.
 *
 * @example
 * ```typescript
 * import { application, serve } from "serverstruct";
 *
 * const app = application((app) => {
 *   app.get("/", () => "Hello world!");
 * });
 *
 * serve(app, { port: 3000 });
 * ```
 *
 * @example With dependency injection
 * ```typescript
 * import { application, serve } from "serverstruct";
 *
 * const app = application((app, box) => {
 *   app.get("/ping", () => "pong");
 *   app.mount("/users", box.get(usersController));
 * });
 *
 * serve(app, { port: 3000 });
 * ```
 */
export function application(
  setup: (app: H3, box: Box) => H3 | void,
  box = new Box(),
): H3 {
  const defaultApp = new H3();
  return setup(defaultApp, box) || defaultApp;
}

/**
 * Creates an H3 app constructor.
 *
 * @param setup - Function that configures the app.
 * @returns A Constructor that produces an H3 app. Not cached by Box.
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
 *   app.mount("/users", box.get(usersController));
 * });
 * ```
 */
export function controller(
  setup: (app: H3, box: Box) => H3 | void,
): Constructor<H3> {
  return transient((box) => application(setup, box));
}

/**
 * Creates a handler constructor.
 *
 * @param setup - Handler function that receives the event and Box instance.
 * @returns A Constructor that produces an H3 handler. Not cached by Box.
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
  Req extends EventHandlerRequest = EventHandlerRequest,
>(setup: (event: H3Event<Req>, box: Box) => Res) {
  return transient((box) =>
    defineHandler<Req, Res>((event) => setup(event, box)),
  );
}

/**
 * Creates an event handler constructor from a setup function.
 *
 * @param setup - Function that receives Box instance and returns an event handler object.
 * @returns A Constructor that produces an H3 event handler. Not cached by Box.
 *
 * @example
 * ```typescript
 * import { application, eventHandler } from "serverstruct";
 *
 * class UserService {
 *   getUser(id: string) { return { id, name: "Alice" }; }
 * }
 *
 * // Define an event handler
 * const getUserHandler = eventHandler((box) => ({
 *   handler(event) {
 *     const userService = box.get(UserService);
 *     const id = event.context.params?.id;
 *     return userService.getUser(id);
 *   },
 *   meta: { auth: true }
 * }));
 *
 * // Use it in your app
 * const app = application((app, box) => {
 *   app.get("/users/:id", box.get(getUserHandler));
 * });
 * ```
 */
export function eventHandler<
  Res = unknown,
  Req extends EventHandlerRequest = EventHandlerRequest,
>(setup: (box: Box) => EventHandlerObject<Req, Res>) {
  return transient((box) => defineHandler<Req, Res>(setup(box)));
}

/**
 * Creates a middleware constructor.
 *
 * @param setup - Middleware function that receives the event, next function, and Box instance.
 * @returns A Constructor that produces an H3 middleware. Not cached by Box.
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
 *     throw new Error("Unauthorized");
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
    next: () => MaybePromise<unknown | undefined>,
    box: Box,
  ) => MaybePromise<unknown | undefined>,
): Constructor<Middleware> {
  return transient((box) =>
    defineMiddleware((event, next) => setup(event, next, box)),
  );
}

/**
 * A request-scoped context store for associating values with H3 events.
 *
 * Each request gets its own isolated context that is automatically cleaned up
 * when the request completes. Uses a WeakMap internally to ensure values are
 * garbage collected with their events.
 *
 * @example
 * ```typescript
 * import { application, Context } from "serverstruct";
 *
 * const userContext = new Context<User>();
 *
 * const app = application((app) => {
 *   app.use((event) => {
 *     userContext.set(event, { id: "123", name: "Alice" });
 *   });
 *   app.get("/user", (event) => {
 *     const user = userContext.get(event);
 *     return user;
 *   });
 * });
 * ```
 */
export class Context<T> {
  #map = new WeakMap<H3Event<any>, T>();

  /**
   * Sets a value for the given event.
   */
  public set(event: H3Event<any>, value: T) {
    this.#map.set(event, value);
  }

  /**
   * Gets the value for the given event.
   * @throws Error if no value is set for the event.
   */
  public get(event: H3Event<any>): T {
    if (this.#map.has(event)) {
      return this.#map.get(event)!;
    }
    throw new Error("context not found");
  }

  /**
   * Gets the value for the given event, or undefined if not set.
   */
  public lookup(event: H3Event<any>): T | undefined {
    return this.#map.get(event);
  }
}

/**
 * Creates a request-scoped context store for associating values with H3 events.
 *
 * Each request gets its own isolated context that is automatically cleaned up
 * when the request completes. Uses a WeakMap internally to ensure values are
 * garbage collected with their events.
 *
 * @returns A Context instance.
 *
 * @example
 * ```typescript
 * import { application, context } from "serverstruct";
 *
 * const userContext = context<User>();
 *
 * const app = application((app) => {
 *   app.use((event) => {
 *     userContext.set(event, { id: "123", name: "Alice" });
 *   });
 *   app.get("/user", (event) => {
 *     const user = userContext.get(event);
 *     return user;
 *   });
 * });
 * ```
 */
export function context<T>() {
  return new Context<T>();
}
