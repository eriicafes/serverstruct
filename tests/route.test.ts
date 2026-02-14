import { Box, constant } from "getbox";
import { H3 } from "h3";
import { describe, expect, test, vi } from "vitest";
import {
  application,
  controller,
  eventHandler,
  handler,
  middleware,
} from "../src";

describe("Application", () => {
  const EnvToken = constant({ env: "testing" });
  const box = new Box();

  const app = application((app, box) => {
    const env = box.get(EnvToken);
    app.get("/", () => "success");
    app.get("/env", () => env);
  }, box);

  test("matches routes", async () => {
    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  test("route can access box dependencies", async () => {
    const res = await app.app.request("/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("serve returns a server instance", () => {
    const server = app.serve({ manual: true });

    expect(server).toBeDefined();
    expect(typeof server.close).toBe("function");
    expect(typeof server.serve).toBe("function");
    expect(server.node).toBeDefined();
  });
});

describe("Controller", () => {
  const EnvToken = constant({ env: "testing" });
  const box = new Box();

  const innerController = controller((app, box) => {
    const env = box.get(EnvToken);
    app.get("/env", () => env);
  });

  const customController = controller((_app, box) => {
    const customApp = new H3();
    const env = box.get(EnvToken);
    customApp.get("/sub/env", () => env);
    return customApp;
  });

  const app = application((app, box) => {
    app.mount("/inner", box.new(innerController));
    app.mount("/custom", box.new(customController));
  }, box);

  test("controller can access box dependencies", async () => {
    const res = await app.app.request("/inner/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("controller returns custom H3 app", async () => {
    // The custom app has basePath "sub", so routes are nested
    const res = await app.app.request("/custom/sub/env");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });
});

describe("Handler", () => {
  test("handler can access box dependencies", async () => {
    const ConfigToken = constant({ value: "config" });

    const getConfigHandler = handler((_event, box) => {
      const config = box.get(ConfigToken);
      return config;
    });

    const app = application((app, box) => {
      app.get("/config", box.get(getConfigHandler));
    });

    const res = await app.app.request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ value: "config" });
  });

  test("handler shares box instance with application", async () => {
    const ConfigToken = constant({ value: "shared" });
    const box = new Box();
    const appAction = vi.fn();
    const handlerAction = vi.fn();

    const getConfigHandler = handler((_event, box) => {
      const config = box.get(ConfigToken);
      handlerAction(config);
      return config;
    });

    const app = application((app, box) => {
      const config = box.get(ConfigToken);
      appAction(config);
      app.get("/config", box.get(getConfigHandler));
    }, box);

    await app.app.request("/config");

    // Both should get the same object instance
    expect(appAction.mock.lastCall?.[0]).toBe(handlerAction.mock.lastCall?.[0]);
  });
});

describe("EventHandler", () => {
  test("eventHandler can access box dependencies", async () => {
    const ConfigToken = constant({ value: "config" });

    const getConfigHandler = eventHandler((box) => ({
      handler: () => {
        const config = box.get(ConfigToken);
        return config;
      },
    }));

    const app = application((app, box) => {
      app.get("/config", box.get(getConfigHandler));
    });

    const res = await app.app.request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ value: "config" });
  });

  test("eventHandler shares box instance with application", async () => {
    const ConfigToken = constant({ value: "shared" });
    const box = new Box();
    const appAction = vi.fn();
    const handlerAction = vi.fn();

    const getConfigHandler = eventHandler((box) => ({
      handler: () => {
        const config = box.get(ConfigToken);
        handlerAction(config);
        return config;
      },
    }));

    const app = application((app, box) => {
      const config = box.get(ConfigToken);
      appAction(config);
      app.get("/config", box.get(getConfigHandler));
    }, box);

    await app.app.request("/config");

    // Both should get the same object instance
    expect(appAction.mock.lastCall?.[0]).toBe(handlerAction.mock.lastCall?.[0]);
  });

  test("eventHandler with meta option", async () => {
    const getDataHandler = eventHandler((_box) => ({
      handler: () => ({ data: "test" }),
      meta: { auth: true, role: "admin" },
    }));

    const app = application((app, box) => {
      const handler = box.get(getDataHandler);
      app.get("/data", handler);

      // Verify meta is accessible
      expect(handler.meta).toStrictEqual({ auth: true, role: "admin" });
    });

    const res = await app.app.request("/data");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ data: "test" });
  });

  test("eventHandler with middleware option", async () => {
    const middlewareAction = vi.fn();

    const protectedHandler = eventHandler((_box) => ({
      handler: () => ({ data: "protected" }),
      middleware: [
        () => {
          middlewareAction();
        },
      ],
    }));

    const app = application((app, box) => {
      app.get("/protected", box.get(protectedHandler));
    });

    const res = await app.app.request("/protected");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ data: "protected" });
    expect(middlewareAction).toHaveBeenCalled();
  });

  test("eventHandler with multiple options", async () => {
    const ConfigToken = constant({ value: "multi-config" });
    const middlewareAction = vi.fn();

    const complexHandler = eventHandler((box) => ({
      handler: () => {
        const config = box.get(ConfigToken);
        return {
          config,
        };
      },
      meta: { version: "1.0", public: false },
      middleware: [
        () => {
          middlewareAction();
        },
      ],
    }));

    const app = application((app, box) => {
      const handler = box.get(complexHandler);
      app.get("/complex", handler);

      // Verify meta is accessible
      expect(handler.meta).toStrictEqual({ version: "1.0", public: false });
    });

    const res = await app.app.request("/complex");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      config: { value: "multi-config" },
    });
    expect(middlewareAction).toHaveBeenCalled();
  });
});

describe("Middleware", () => {
  test("middleware executes", async () => {
    const middlewareAction = vi.fn();

    const testMiddleware = middleware((_event, _next, _box) => {
      middlewareAction();
    });

    const app = application((app, box) => {
      app.use(box.get(testMiddleware));
      app.get("/", () => ({ message: "Success" }));
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(middlewareAction).toHaveBeenCalled();
  });

  test("middleware can access box dependencies", async () => {
    const ConfigToken = constant({ value: "middleware-config" });

    const configMiddleware = middleware((_event, _next, box) => {
      const config = box.get(ConfigToken);
      expect(config).toStrictEqual({ value: "middleware-config" });
    });

    const app = application((app, box) => {
      app.use(box.get(configMiddleware));
      app.get("/", () => ({ message: "Success" }));
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
  });

  test("middleware shares box instance with application", async () => {
    const ConfigToken = constant({ value: "shared" });
    const box = new Box();
    const middlewareAction = vi.fn();
    const appAction = vi.fn();

    const configMiddleware = middleware((_event, _next, box) => {
      const config = box.get(ConfigToken);
      middlewareAction(config);
    });

    const app = application((app, box) => {
      const config = box.get(ConfigToken);
      appAction(config);
      app.use(box.get(configMiddleware));
      app.get("/", () => ({ message: "Success" }));
    }, box);

    await app.app.request("/");

    // Both should get the same object instance
    expect(middlewareAction.mock.lastCall?.[0]).toBe(
      appAction.mock.lastCall?.[0],
    );
  });

  test("middleware can call next", async () => {
    const logMiddleware = middleware(async (_event, next, _box) => {
      const result = await next();
      return result;
    });

    const app = application((app, box) => {
      app.use(box.get(logMiddleware));
      app.get("/", () => ({ message: "Success" }));
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ message: "Success" });
  });
});
