import { H3 } from "h3";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createRouter,
  jsonRequest,
  jsonResponse,
  metadata,
  OpenApiPaths,
} from "../src/openapi";

/** Minimal valid operation object. */
function op(operationId: string) {
  return { operationId, responses: {} } as const;
}

describe("OpenApiPaths", () => {
  test("get() registers a GET operation", () => {
    const paths = new OpenApiPaths();
    const operation = op("getUser");

    paths.get("/users/{id}", operation);

    expect(paths.paths["/users/{id}"]).toStrictEqual({ get: operation });
  });

  test("post() registers a POST operation", () => {
    const paths = new OpenApiPaths();
    const operation = op("createUser");

    paths.post("/users", operation);

    expect(paths.paths["/users"]).toStrictEqual({ post: operation });
  });

  test("put() registers a PUT operation", () => {
    const paths = new OpenApiPaths();
    const operation = op("updateUser");

    paths.put("/users/{id}", operation);

    expect(paths.paths["/users/{id}"]).toStrictEqual({ put: operation });
  });

  test("delete() registers a DELETE operation", () => {
    const paths = new OpenApiPaths();
    const operation = op("deleteUser");

    paths.delete("/users/{id}", operation);

    expect(paths.paths["/users/{id}"]).toStrictEqual({ delete: operation });
  });

  test("patch() registers a PATCH operation", () => {
    const paths = new OpenApiPaths();
    const operation = op("patchUser");

    paths.patch("/users/{id}", operation);

    expect(paths.paths["/users/{id}"]).toStrictEqual({ patch: operation });
  });

  test("all() registers for all standard HTTP methods", () => {
    const paths = new OpenApiPaths();
    const operation = op("allUsers");

    paths.all("/users", operation);

    expect(paths.paths["/users"]).toStrictEqual({
      get: operation,
      post: operation,
      put: operation,
      delete: operation,
      patch: operation,
    });
  });

  test("on() registers for specific methods", () => {
    const paths = new OpenApiPaths();
    const operation = op("usersOp");

    paths.on(["get", "post"], "/users", operation);

    expect(paths.paths["/users"]).toStrictEqual({
      get: operation,
      post: operation,
    });
  });

  test("accumulates operations on the same path", () => {
    const paths = new OpenApiPaths();
    const getOp = op("getUser");
    const postOp = op("createUser");

    paths.get("/users", getOp);
    paths.post("/users", postOp);

    expect(paths.paths["/users"]).toStrictEqual({
      get: getOp,
      post: postOp,
    });
  });

  test("returns RouterContext with raw schemas", () => {
    const paths = new OpenApiPaths();
    const bodySchema = z.object({ name: z.string() }).meta({});
    const paramsSchema = z.object({ id: z.string() }).meta({});
    const querySchema = z.object({ page: z.string() }).meta({});
    const headersSchema = z.object({ "x-api-key": z.string() }).meta({});

    const ctx = paths.post("/users/{id}", {
      operationId: "createUser",
      requestParams: {
        path: paramsSchema,
        query: querySchema,
        header: headersSchema,
      },
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    expect(ctx.schemas.params).toBe(paramsSchema);
    expect(ctx.schemas.query).toBe(querySchema);
    expect(ctx.schemas.headers).toBe(headersSchema);
    expect(ctx.schemas.body).toBe(bodySchema);
  });

  test("returns undefined schemas when not provided", () => {
    const paths = new OpenApiPaths();

    const ctx = paths.get("/users", op("getUsers"));

    expect(ctx.schemas.params).toBeUndefined();
    expect(ctx.schemas.query).toBeUndefined();
    expect(ctx.schemas.body).toBeUndefined();
    expect(ctx.schemas.headers).toBeUndefined();
  });
});

describe("RouterContext", () => {
  test("params() validates route parameters with schema", async () => {
    const paths = new OpenApiPaths();
    const paramsSchema = z.object({ id: z.string() }).meta({});

    const ctx = paths.get("/users/{id}", {
      operationId: "getUser",
      requestParams: { path: paramsSchema },
      responses: {},
    });

    const app = new H3();
    app.get("/users/:id", async (event) => {
      return await ctx.params(event);
    });

    const res = await app.request("/users/123");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ id: "123" });
  });

  test("params() returns raw params when no schema", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.get("/users/{id}", op("getUser"));

    const app = new H3();
    app.get("/users/:id", async (event) => {
      return await ctx.params(event);
    });

    const res = await app.request("/users/456");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ id: "456" });
  });

  test("query() validates query parameters with schema", async () => {
    const paths = new OpenApiPaths();
    const querySchema = z.object({ page: z.string() }).meta({});

    const ctx = paths.get("/users", {
      operationId: "getUsers",
      requestParams: { query: querySchema },
      responses: {},
    });

    const app = new H3();
    app.get("/users", async (event) => {
      return await ctx.query(event);
    });

    const res = await app.request("/users?page=2");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ page: "2" });
  });

  test("query() returns raw query when no schema", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.get("/users", op("getUsers"));

    const app = new H3();
    app.get("/users", async (event) => {
      return await ctx.query(event);
    });

    const res = await app.request("/users?page=3&limit=10");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ page: "3", limit: "10" });
  });

  test("body() validates request body with schema", async () => {
    const paths = new OpenApiPaths();
    const bodySchema = z.object({ title: z.string() }).meta({});

    const ctx = paths.post("/posts", {
      operationId: "createPost",
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ title: "Hello" });
  });

  test("body() reads raw body when no schema", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.post("/posts", op("createPost"));

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Raw" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ title: "Raw" });
  });

  test("reply() sets response status and returns data", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({ id: z.string() }).meta({});

    const ctx = paths.post("/posts", {
      operationId: "createPost",
      responses: {
        201: jsonResponse(responseSchema, { description: "Created" }),
      },
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return ctx.reply(event, 201, { id: "1" });
    });

    const res = await app.request("/posts", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ id: "1" });
  });

  test("reply() sets response headers", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({ id: z.string() }).meta({});
    const headersSchema = z.object({ "x-request-id": z.string() }).meta({});

    const ctx = paths.get("/posts/{id}", {
      operationId: "getPost",
      responses: {
        200: jsonResponse(responseSchema, {
          description: "Success",
          headers: headersSchema,
        }),
      },
    });

    const app = new H3();
    app.get("/posts/:id", async (event) => {
      return ctx.reply(event, 200, { id: "1" }, { "x-request-id": "abc-123" });
    });

    const res = await app.request("/posts/1");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("abc-123");
    expect(await res.json()).toStrictEqual({ id: "1" });
  });
});

describe("OpenApiRouter", () => {
  test("registers route on H3 app and path on OpenApiPaths", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.get("/users", op("getUsers"), () => {
      return { users: [] };
    });

    expect(paths.paths["/users"]).toBeDefined();
    expect(paths.paths["/users"]!.get).toStrictEqual(op("getUsers"));

    const res = await app.request("/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ users: [] });
  });

  test("handler receives RouterContext", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);
    const bodySchema = z.object({ title: z.string() }).meta({});

    router.post(
      "/posts",
      {
        operationId: "createPost",
        requestBody: jsonRequest(bodySchema),
        responses: {
          201: jsonResponse(z.object({ id: z.string() }).meta({}), {
            description: "Created",
          }),
        },
      },
      async (event, ctx) => {
        const body = await ctx.body(event);
        return ctx.reply(event, 201, { id: "new-" + body.title });
      },
    );

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "hello" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ id: "new-hello" });
  });

  test("converts H3 path syntax to OpenAPI format", () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.get("/users/:id", op("getUser"), () => ({}));
    router.get("/files/*", op("getFile"), () => ({}));
    router.get("/docs/**", op("getDocs"), () => ({}));

    expect(paths.paths["/users/{id}"]).toBeDefined();
    expect(paths.paths["/files/{param}"]).toBeDefined();
    expect(paths.paths["/docs/{path}"]).toBeDefined();
  });

  test("post() registers POST route", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.post("/items", op("createItem"), () => ({
      created: true,
    }));

    const res = await app.request("/items", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ created: true });
  });

  test("put() registers PUT route", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.put("/items/:id", op("updateItem"), () => ({
      updated: true,
    }));

    const res = await app.request("/items/1", { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ updated: true });
  });

  test("delete() registers DELETE route", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.delete("/items/:id", op("deleteItem"), () => ({
      deleted: true,
    }));

    const res = await app.request("/items/1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ deleted: true });
  });

  test("patch() registers PATCH route", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.patch("/items/:id", op("patchItem"), () => ({
      patched: true,
    }));

    const res = await app.request("/items/1", { method: "PATCH" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ patched: true });
  });

  test("all() registers for all HTTP methods", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.all("/echo", op("echo"), () => ({ echo: true }));

    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      const res = await app.request("/echo", { method });
      expect(res.status).toBe(200);
    }

    const pathItem = paths.paths["/echo"];
    expect(pathItem?.get).toBeDefined();
    expect(pathItem?.post).toBeDefined();
    expect(pathItem?.put).toBeDefined();
    expect(pathItem?.delete).toBeDefined();
    expect(pathItem?.patch).toBeDefined();
  });

  test("on() registers for specific methods", async () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    router.on(["get", "post"], "/items", op("items"), () => ({ ok: true }));

    const getRes = await app.request("/items");
    expect(getRes.status).toBe(200);

    const postRes = await app.request("/items", { method: "POST" });
    expect(postRes.status).toBe(200);
  });

  test("methods return the router for chaining", () => {
    const app = new H3();
    const paths = new OpenApiPaths();
    const router = createRouter(app, paths);

    const result = router
      .get("/a", op("a"), () => ({}))
      .post("/b", op("b"), () => ({}))
      .put("/c", op("c"), () => ({}))
      .delete("/d", op("d"), () => ({}))
      .patch("/e", op("e"), () => ({}));

    expect(result).toBe(router);
  });
});

describe("jsonRequest", () => {
  test("builds requestBody with application/json content", () => {
    const schema = z.object({ name: z.string() }).meta({});
    const result = jsonRequest(schema);

    expect(result).toStrictEqual({
      content: {
        "application/json": { schema },
      },
    });
  });

  test("passes additional options", () => {
    const schema = z.object({ name: z.string() }).meta({});
    const result = jsonRequest(schema, {
      description: "Create a user",
      content: { example: { name: "Alice" } },
    });

    expect(result.description).toBe("Create a user");
    expect(result.content["application/json"].schema).toBe(schema);
    expect(result.content["application/json"].example).toStrictEqual({
      name: "Alice",
    });
  });
});

describe("jsonResponse", () => {
  test("builds response with application/json content", () => {
    const schema = z.object({ id: z.string() }).meta({});
    const result = jsonResponse(schema, { description: "Success" });

    expect(result.description).toBe("Success");
    expect(result.content["application/json"].schema).toBe(schema);
  });

  test("passes headers through", () => {
    const schema = z.object({ id: z.string() }).meta({});
    const headers = z.object({ "x-request-id": z.string() }).meta({});
    const result = jsonResponse(schema, {
      description: "Success",
      headers,
    });

    expect(result.headers).toBe(headers);
  });

  test("passes additional options", () => {
    const schema = z.object({ id: z.string() }).meta({});
    const result = jsonResponse(schema, {
      description: "Success",
      content: { example: { id: "1" } },
    });

    expect(result.content["application/json"].example).toStrictEqual({
      id: "1",
    });
  });
});

describe("metadata", () => {
  test("passes metadata through", () => {
    const meta = metadata({
      description: "A user object",
      example: { id: "1" },
    });

    expect(meta).toStrictEqual({
      description: "A user object",
      example: { id: "1" },
    });
  });
});
