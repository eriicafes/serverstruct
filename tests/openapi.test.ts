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
    const bodySchema = z.object({ name: z.string() });
    const paramsSchema = z.object({ id: z.string() });
    const querySchema = z.object({ page: z.string() });
    const headersSchema = z.object({ "x-api-key": z.string() });
    const cookiesSchema = z.object({ session: z.string() });

    const ctx = paths.post("/users/{id}", {
      operationId: "createUser",
      requestParams: {
        path: paramsSchema,
        query: querySchema,
        header: headersSchema,
        cookie: cookiesSchema,
      },
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    expect(ctx.schemas.params).toBe(paramsSchema);
    expect(ctx.schemas.query).toBe(querySchema);
    expect(ctx.schemas.headers).toBe(headersSchema);
    expect(ctx.schemas.cookies).toBe(cookiesSchema);
    expect(ctx.schemas.body).toBe(bodySchema);
  });

  test("returns undefined schemas when not provided", () => {
    const paths = new OpenApiPaths();

    const ctx = paths.get("/users", op("getUsers"));

    expect(ctx.schemas.params).toBeUndefined();
    expect(ctx.schemas.query).toBeUndefined();
    expect(ctx.schemas.headers).toBeUndefined();
    expect(ctx.schemas.cookies).toBeUndefined();
    expect(ctx.schemas.body).toBeUndefined();
  });
});

describe("RouterContext", () => {
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

  test("params() validates route parameters with schema", async () => {
    const paths = new OpenApiPaths();
    const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
    const ctx = paths.get("/users/{id}", {
      operationId: "getUser",
      requestParams: { path: paramsSchema },
      responses: {},
    });

    const app = new H3();
    app.get("/users/:id", async (event) => {
      return await ctx.params(event);
    });

    // Valid params
    const validRes = await app.request("/users/123");
    expect(validRes.status).toBe(200);
    expect(await validRes.json()).toStrictEqual({ id: 123 });

    // Invalid params
    const invalidRes = await app.request("/users/not-a-number");
    expect(invalidRes.status).toBe(400);
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

  test("query() validates query parameters with schema", async () => {
    const paths = new OpenApiPaths();
    const querySchema = z.object({ page: z.coerce.number().int().positive() });
    const ctx = paths.get("/users", {
      operationId: "getUsers",
      requestParams: { query: querySchema },
      responses: {},
    });

    const app = new H3();
    app.get("/users", async (event) => {
      return await ctx.query(event);
    });

    // Valid query
    const validRes = await app.request("/users?page=2");
    expect(validRes.status).toBe(200);
    expect(await validRes.json()).toStrictEqual({ page: 2 });

    // Invalid query
    const invalidRes = await app.request("/users?page=invalid");
    expect(invalidRes.status).toBe(400);
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

  test("body() validates request body with schema", async () => {
    const paths = new OpenApiPaths();
    const bodySchema = z.object({
      title: z.string().min(3),
      published: z.boolean(),
    });
    const ctx = paths.post("/posts", {
      operationId: "createPost",
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    // Valid body
    const validRes = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello World", published: true }),
    });
    expect(validRes.status).toBe(200);
    expect(await validRes.json()).toStrictEqual({
      title: "Hello World",
      published: true,
    });

    // Invalid body
    const invalidRes = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "ab", published: "not-a-boolean" }),
    });
    expect(invalidRes.status).toBe(400);
  });

  test("body() handles url-encoded form without schema", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.post("/posts", op("createPost"));

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const params = new URLSearchParams();
    params.append("title", "Test Post");
    params.append("author", "Bob");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result).toStrictEqual({ title: "Test Post", author: "Bob" });
  });

  test("body() handles url-encoded form with JSON schema", async () => {
    const paths = new OpenApiPaths();
    const bodySchema = z.object({ title: z.string(), author: z.string() });
    const ctx = paths.post("/posts", {
      operationId: "createPost",
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const params = new URLSearchParams();
    params.append("title", "Test Post");
    params.append("author", "Alice");

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result).toStrictEqual({ title: "Test Post", author: "Alice" });
  });

  test("body() rejects multipart form-data without schema", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.post("/posts", op("createPost"));

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const formData = new FormData();
    formData.append("title", "Test Post");

    const res = await app.request("/posts", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(400);
  });

  test("body() rejects multipart form-data with JSON schema", async () => {
    const paths = new OpenApiPaths();
    const bodySchema = z.object({ title: z.string() });

    const ctx = paths.post("/posts", {
      operationId: "createPost",
      requestBody: jsonRequest(bodySchema),
      responses: {},
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return await ctx.body(event);
    });

    const formData = new FormData();
    formData.append("title", "Test Post");

    const res = await app.request("/posts", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(400);
  });

  test("reply() sets response status and returns data", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({ id: z.string() });

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
    const responseSchema = z.object({ id: z.string() });
    const headersSchema = z.object({ "x-request-id": z.string() });

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

  test("validReply() works without schemas", async () => {
    const paths = new OpenApiPaths();

    const ctx = paths.post("/posts", {
      operationId: "createPost",
      responses: {
        201: { description: "Created" },
      },
    });

    const app = new H3();
    app.post("/posts", async (event) => {
      return ctx.validReply(event, 201, { id: "any-value" });
    });

    const res = await app.request("/posts", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ id: "any-value" });
  });

  test("validReply() validates response data", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({
      score: z.number().int().min(0).max(100),
    });

    const ctx = paths.post("/scores", {
      operationId: "createScore",
      responses: {
        201: jsonResponse(responseSchema, { description: "Created" }),
      },
    });

    const app = new H3();
    app.post("/scores", async (event) => {
      return ctx.validReply(event, 201, { score: 85 });
    });

    // Valid response
    const validRes = await app.request("/scores", { method: "POST" });
    expect(validRes.status).toBe(201);
    expect(await validRes.json()).toStrictEqual({ score: 85 });

    // Invalid response
    const invalidApp = new H3({ silent: true });
    invalidApp.post("/scores", async (event) => {
      return ctx.validReply(event, 201, { score: 150 });
    });

    const invalidRes = await invalidApp.request("/scores", {
      method: "POST",
    });
    expect(invalidRes.status).toBe(500);
  });

  test("validReply() validates response headers", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({ id: z.string() });
    const headersSchema = z.object({
      "x-count": z.coerce.number().int().min(1),
    });

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
      return ctx.validReply(event, 200, { id: "1" }, { "x-count": 5 });
    });

    // Valid headers
    const validRes = await app.request("/posts/1");
    expect(validRes.status).toBe(200);
    expect(validRes.headers.get("x-count")).toBe("5");

    // Invalid headers
    const invalidApp = new H3({ silent: true });
    invalidApp.get("/posts/:id", async (event) => {
      return ctx.validReply(event, 200, { id: "1" }, { "x-count": -1 });
    });

    const invalidRes = await invalidApp.request("/posts/1");
    expect(invalidRes.status).toBe(500);

    // No headers
    const invalidApp2 = new H3({ silent: true });
    invalidApp2.get("/posts/:id", async (event) => {
      return ctx.validReply(event, 200, { id: "1" });
    });

    const invalidRes2 = await invalidApp2.request("/posts/1");
    expect(invalidRes2.status).toBe(500);
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
    const bodySchema = z.object({ title: z.string() });

    router.post(
      "/posts",
      {
        operationId: "createPost",
        requestBody: jsonRequest(bodySchema),
        responses: {
          201: jsonResponse(z.object({ id: z.string() }), {
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
    const schema = z.object({ name: z.string() });
    const result = jsonRequest(schema);

    expect(result).toStrictEqual({
      required: true,
      content: {
        "application/json": { schema },
      },
    });
  });

  test("passes additional options", () => {
    const schema = z.object({ name: z.string() });
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
    const schema = z.object({ id: z.string() });
    const result = jsonResponse(schema, { description: "Success" });

    expect(result.description).toBe("Success");
    expect(result.content["application/json"].schema).toBe(schema);
  });

  test("passes headers through", () => {
    const schema = z.object({ id: z.string() });
    const headers = z.object({ "x-request-id": z.string() });
    const result = jsonResponse(schema, {
      description: "Success",
      headers,
    });

    expect(result.headers).toBe(headers);
  });

  test("passes additional options", () => {
    const schema = z.object({ id: z.string() });
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
