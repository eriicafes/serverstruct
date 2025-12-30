import { describe, expect, test } from "vitest";
import { application, Context, context, middleware } from "../src";

describe("Context", () => {
  test("creates a Context instance", () => {
    const userContext = context<string>();

    expect(userContext).toBeInstanceOf(Context);
  });

  test("set and get value in request", async () => {
    const userContext = new Context<{ id: string; name: string }>();

    const authMiddleware = middleware((event) => {
      userContext.set(event, { id: "123", name: "Alice" });
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/user", (event) => {
        const user = userContext.get(event);
        return user;
      });
    });

    const res = await app.app.request("/user");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ id: "123", name: "Alice" });
  });

  test("get throws error when context not found", async () => {
    const userContext = new Context<string>();

    const app = application((app) => {
      app.get("/", (event) => {
        try {
          userContext.get(event);
          return { error: false };
        } catch (error) {
          return {
            error: true,
            message: error instanceof Error ? error.message : "unknown",
          };
        }
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      error: true,
      message: "context not found",
    });
  });

  test("lookup returns value when set", async () => {
    const userContext = new Context<string>();

    const authMiddleware = middleware((event) => {
      userContext.set(event, "test-value");
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/", (event) => {
        const value = userContext.lookup(event);
        return { value };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ value: "test-value" });
  });

  test("lookup returns undefined when not set", async () => {
    const userContext = new Context<string>();

    const app = application((app) => {
      app.get("/", (event) => {
        const value = userContext.lookup(event);
        return { value: value ?? null };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ value: null });
  });

  test("different requests have separate contexts", async () => {
    const userContext = new Context<string>();
    let requestCounter = 0;

    const authMiddleware = middleware((event) => {
      requestCounter++;
      userContext.set(event, `user-${requestCounter}`);
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/", (event) => {
        const user = userContext.get(event);
        return { user };
      });
    });

    const res1 = await app.app.request("/");
    expect(await res1.json()).toStrictEqual({ user: "user-1" });

    const res2 = await app.app.request("/");
    expect(await res2.json()).toStrictEqual({ user: "user-2" });
  });

  test("overwriting value for same request", async () => {
    const counterContext = new Context<number>();

    const middleware1 = middleware((event) => {
      counterContext.set(event, 42);
    });

    const middleware2 = middleware((event) => {
      counterContext.set(event, 100);
    });

    const app = application((app, box) => {
      app.use(box.get(middleware1));
      app.use(box.get(middleware2));
      app.get("/", (event) => {
        const count = counterContext.get(event);
        return { count };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ count: 100 });
  });

  test("context works with complex types", async () => {
    interface User {
      id: string;
      name: string;
      roles: string[];
    }

    const userContext = new Context<User>();

    const authMiddleware = middleware((event) => {
      userContext.set(event, {
        id: "123",
        name: "Alice",
        roles: ["admin", "user"],
      });
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/user", (event) => {
        const user = userContext.get(event);
        return user;
      });
    });

    const res = await app.app.request("/user");
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user).toEqual({
      id: "123",
      name: "Alice",
      roles: ["admin", "user"],
    });
    expect(user.roles).toContain("admin");
  });

  test("multiple contexts for same request", async () => {
    const userContext = new Context<{ name: string }>();
    const sessionContext = new Context<{ token: string }>();

    const authMiddleware = middleware((event) => {
      userContext.set(event, { name: "Alice" });
      sessionContext.set(event, { token: "abc123" });
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/", (event) => {
        const user = userContext.get(event);
        const session = sessionContext.get(event);
        return { user, session };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      user: { name: "Alice" },
      session: { token: "abc123" },
    });
  });

  test("context with null value", async () => {
    const context = new Context<string | null>();

    const authMiddleware = middleware((event) => {
      context.set(event, null);
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/", (event) => {
        const value = context.get(event);
        const lookupValue = context.lookup(event);
        return { value, lookupValue };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ value: null, lookupValue: null });
  });

  test("context with undefined value", async () => {
    const context = new Context<string | undefined>();

    const authMiddleware = middleware((event) => {
      context.set(event, undefined);
    });

    const app = application((app, box) => {
      app.use(box.get(authMiddleware));
      app.get("/", (event) => {
        const value = context.get(event);
        const lookupValue = context.lookup(event);
        return {
          value: value ?? "fallback",
          lookupValue: lookupValue ?? "fallback",
        };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      value: "fallback",
      lookupValue: "fallback",
    });
  });

  test("context accessible across middleware chain", async () => {
    const requestIdContext = new Context<string>();

    const middleware1 = middleware((event) => {
      requestIdContext.set(event, "req-123");
    });

    const middleware2 = middleware((event) => {
      const id = requestIdContext.get(event);
      requestIdContext.set(event, `${id}-processed`);
    });

    const app = application((app, box) => {
      app.use(box.get(middleware1));
      app.use(box.get(middleware2));
      app.get("/", (event) => {
        const requestId = requestIdContext.get(event);
        return { requestId };
      });
    });

    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ requestId: "req-123-processed" });
  });

  test("concurrent requests don't mix up contexts", async () => {
    const pathContext = new Context<{ path: string }>();

    const app = application((app) => {
      app.use(async (event) => {
        const path = event.url.pathname;
        // Simulate async work with random delays
        const delay = Math.floor(Math.random() * 6) + 5; // 5-10ms
        await new Promise((resolve) => setTimeout(resolve, delay));
        pathContext.set(event, { path });
      });
      app.get("/:id", (event) => pathContext.get(event));
    });

    // Create 100 concurrent requests
    const requests = Array.from({ length: 100 }, (_, i) =>
      app.app.request(`/${i}`)
    );

    const responses = await Promise.all(requests);
    const results = await Promise.all(responses.map((res) => res.json()));

    // Verify each request got its correct context
    results.forEach((result, i) => {
      expect(result).toEqual({ path: `/${i}` });
    });
  });
});
