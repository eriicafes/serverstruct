import { Box } from "getbox";
import { H3 } from "h3";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { application, controller } from "../src";
import {
  jsonRequest,
  jsonResponse,
  metadata,
  OpenApiPaths,
  route,
  useRouter,
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

  test("on() does not overwrite existing entry for same path and method", () => {
    const paths = new OpenApiPaths();
    const op1 = op("first");
    const op2 = op("second");

    paths.get("/users", op1);
    paths.get("/users", op2);

    expect(paths.paths["/users"]!.get).toBe(op1);
  });

  test("mount() adds multiple sub-paths with prefix", () => {
    const parent = new OpenApiPaths();
    const sub = new OpenApiPaths();

    const listOp = op("listUsers");
    const getOp = op("getUser");
    sub.get("/", listOp);
    sub.get("/{id}", getOp);

    parent.mount("/users", sub);

    expect(parent.paths["/users"]?.get?.operationId).toBe("listUsers");
    expect(parent.paths["/users/{id}"]?.get?.operationId).toBe("getUser");
  });

  test("mount() does not overwrite existing paths", () => {
    const parent = new OpenApiPaths();
    const sub1 = new OpenApiPaths();
    const sub2 = new OpenApiPaths();
    const op1 = op("first");
    const op2 = op("second");

    sub1.get("/", op1);
    sub2.get("/", op2);

    parent.mount("/api", sub1);
    parent.mount("/api", sub2);

    expect(parent.paths["/api"]!.get).toBe(op1);
  });

  test("mount() strips trailing slash from prefix", () => {
    const parent = new OpenApiPaths();
    const sub = new OpenApiPaths();

    sub.get("/", op("getRoot"));
    sub.get("/items", op("getItems"));

    parent.mount("/api/", sub);

    expect(parent.paths["/api"]?.get?.operationId).toBe("getRoot");
    expect(parent.paths["/api/items"]?.get?.operationId).toBe("getItems");
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

  test("validReply() returns coerced data from schema transform", async () => {
    const paths = new OpenApiPaths();
    const responseSchema = z.object({
      score: z.number().transform((n) => Math.round(n)),
    });

    const ctx = paths.post("/scores", {
      operationId: "createScore",
      responses: {
        201: jsonResponse(responseSchema, { description: "Created" }),
      },
    });

    const app = new H3();
    app.post("/scores", async (event) => {
      return ctx.validReply(event, 201, { score: 85.7 });
    });

    const res = await app.request("/scores", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ score: 86 });
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
    const router = useRouter(app);

    router.get("/users", op("getUsers"), () => {
      return { users: [] };
    });

    expect(router.paths()["/users"]).toBeDefined();
    expect(router.paths()["/users"]!.get).toStrictEqual(op("getUsers"));

    const res = await app.request("/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ users: [] });
  });

  test("handler receives RouterContext", async () => {
    const app = new H3();
    const router = useRouter(app);
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
    const router = useRouter(app);

    router.get("/users/:id", op("getUser"), () => ({}));
    router.get("/files/*", op("getFile"), () => ({}));
    router.get("/docs/**", op("getDocs"), () => ({}));

    expect(router.paths()["/users/{id}"]).toBeDefined();
    expect(router.paths()["/files/{param}"]).toBeDefined();
    expect(router.paths()["/docs/{path}"]).toBeDefined();
  });

  test("converts multiple param segments to OpenAPI format", () => {
    const app = new H3();
    const router = useRouter(app);

    router.get("/users/:userId/posts/:postId", op("getPost"), () => ({}));

    expect(router.paths()["/users/{userId}/posts/{postId}"]).toBeDefined();
  });

  test("converts path without leading slash to OpenAPI format", () => {
    const app = new H3();
    const router = useRouter(app);

    router.get("users/:id", op("getUser"), () => ({}));

    expect(router.paths()["/users/{id}"]).toBeDefined();
  });

  test("mount() on sub-app without a router still mounts H3 routes", async () => {
    const app = new H3();
    const router = useRouter(app);

    const subApp = new H3();
    subApp.get("/ping", () => ({ pong: true }));

    router.mount("/sub", subApp);

    const res = await app.request("/sub/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ pong: true });

    // No paths transferred since sub has no router
    expect(router.paths()["/sub/ping"]).toBeUndefined();
    expect(router.paths()["/sub"]).toBeUndefined();
  });

  test("post() registers POST route", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.post("/items", op("createItem"), () => ({
      created: true,
    }));

    const res = await app.request("/items", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ created: true });
  });

  test("put() registers PUT route", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.put("/items/:id", op("updateItem"), () => ({
      updated: true,
    }));

    const res = await app.request("/items/1", { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ updated: true });
  });

  test("delete() registers DELETE route", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.delete("/items/:id", op("deleteItem"), () => ({
      deleted: true,
    }));

    const res = await app.request("/items/1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ deleted: true });
  });

  test("patch() registers PATCH route", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.patch("/items/:id", op("patchItem"), () => ({
      patched: true,
    }));

    const res = await app.request("/items/1", { method: "PATCH" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ patched: true });
  });

  test("all() registers for all HTTP methods", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.all("/echo", op("echo"), () => ({ echo: true }));

    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      const res = await app.request("/echo", { method });
      expect(res.status).toBe(200);
    }

    const pathItem = router.paths()["/echo"];
    expect(pathItem?.get).toBeDefined();
    expect(pathItem?.post).toBeDefined();
    expect(pathItem?.put).toBeDefined();
    expect(pathItem?.delete).toBeDefined();
    expect(pathItem?.patch).toBeDefined();
  });

  test("on() registers for specific methods", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.on(["get", "post"], "/items", op("items"), () => ({ ok: true }));

    const getRes = await app.request("/items");
    expect(getRes.status).toBe(200);

    const postRes = await app.request("/items", { method: "POST" });
    expect(postRes.status).toBe(200);
  });

  test("multiple useRouter calls on the same app return the same router", async () => {
    const app = new H3();
    const router1 = useRouter(app);
    const router2 = useRouter(app);

    expect(router1).toBe(router2);

    router1.get("/a", op("getA"), () => ({ from: "router1" }));
    router2.get("/b", op("getB"), () => ({ from: "router2" }));

    // Both H3 routes work
    const resA = await app.request("/a");
    expect(resA.status).toBe(200);
    expect(await resA.json()).toStrictEqual({ from: "router1" });

    const resB = await app.request("/b");
    expect(resB.status).toBe(200);
    expect(await resB.json()).toStrictEqual({ from: "router2" });

    // Both paths visible on the same router instance
    expect(router1.paths()["/a"]?.get?.operationId).toBe("getA");
    expect(router1.paths()["/b"]?.get?.operationId).toBe("getB");
  });

  test("mounted apps apply base path", async () => {
    const box = new Box();

    const subApp = controller((app) => {
      const router = useRouter(app);
      router.get("/", op("getSub"), () => ({ id: "getSub" }));
    });

    let parentRouter!: ReturnType<typeof useRouter>;
    const app = application((app, box) => {
      parentRouter = useRouter(app);

      parentRouter.get("/", op("getBase"), () => ({ id: "getBase" }));
      parentRouter.mount("/sub", box.get(subApp));
    }, box);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ id: "getBase" });

    const subRes = await app.request("/sub");
    expect(subRes.status).toBe(200);
    expect(await subRes.json()).toStrictEqual({ id: "getSub" });

    expect(parentRouter.paths()["/"]?.get?.operationId).toBe("getBase");
    expect(parentRouter.paths()["/sub"]?.get?.operationId).toBe("getSub");
  });

  test("document() serves the OpenAPI document at path", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.get("/posts", op("listPosts"), () => []);
    router.document("/docs", {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      reference: false,
    });

    const res = await app.request("/docs");
    expect(res.status).toBe(200);

    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Test API");
    expect(doc.paths["/posts"]).toBeDefined();
  });

  test("document() mounts Scalar reference at {path}/reference by default", async () => {
    const app = new H3();
    const router = useRouter(app);

    router.document("/docs", {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
    });

    const res = await app.request("/docs/reference");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('"url": "/docs"');
  });

  test("document() with reference: false does not mount reference", async () => {
    const app = new H3({ silent: true });
    const router = useRouter(app);

    router.document("/docs", {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      reference: false,
    });

    const res = await app.request("/docs/reference");
    expect(res.status).toBe(404);
  });

  test("document() with custom reference.path", async () => {
    const app = new H3({ silent: true });
    const router = useRouter(app);

    router.document("/docs", {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      reference: { path: "/reference" },
    });

    const customRes = await app.request("/reference");
    expect(customRes.status).toBe(200);
    const html = await customRes.text();
    expect(html).toContain('"url": "/docs"');

    const defaultRes = await app.request("/docs/reference");
    expect(defaultRes.status).toBe(404);
  });

  test("document() in mounted apps serves correct docs and reference", async () => {
    const box = new Box();

    const v1 = controller((app) => {
      const router = useRouter(app);

      router.get("/posts", op("listPosts"), () => []);
      router.document("/docs", {
        openapi: "3.1.0",
        info: { title: "V1 API", version: "1.0.0" },
      });
    });

    const app = application((app, box) => {
      app.mount("/v1", box.get(v1));
    }, box);

    // OpenAPI document accessible at /v1/docs with the controller's paths
    const docsRes = await app.request("/v1/docs");
    expect(docsRes.status).toBe(200);
    const doc = await docsRes.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("V1 API");
    expect(doc.paths["/v1/posts"]).toBeDefined();

    // Scalar reference accessible at /v1/docs/reference
    const refRes = await app.request("/v1/docs/reference");
    expect(refRes.status).toBe(200);
    const html = await refRes.text();
    expect(html).toContain('"url": "/v1/docs"');
  });
});

describe("Route", () => {
  test("registers operation in paths and handler on app", async () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();
    const operation = op("getUser");

    const getUser = route({
      method: "get",
      path: "/users/:id",
      operation,
      setup: () => () => ({ found: true }),
    });

    app.register(box.get(getUser)(paths));

    expect(paths.paths["/users/{id}"]).toStrictEqual({ get: operation });

    const res = await app.request("/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ found: true });
  });

  test("converts H3 path syntax to OpenAPI format", () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();

    const mk = (path: string, operationId: string) =>
      route({
        method: "get",
        path,
        operation: op(operationId),
        setup: () => () => ({}),
      });

    app.register(box.get(mk("/users/:id", "getUser"))(paths));
    app.register(box.get(mk("/files/*", "getFile"))(paths));
    app.register(box.get(mk("/docs/**", "getDocs"))(paths));

    expect(paths.paths["/users/{id}"]).toBeDefined();
    expect(paths.paths["/files/{param}"]).toBeDefined();
    expect(paths.paths["/docs/{path}"]).toBeDefined();
  });

  test("accepts an array of methods", async () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();
    const operation = op("items");

    const items = route({
      method: ["get", "post"],
      path: "/items",
      operation,
      setup: () => () => ({ ok: true }),
    });

    app.register(box.get(items)(paths));

    expect(paths.paths["/items"]).toStrictEqual({
      get: operation,
      post: operation,
    });

    const getRes = await app.request("/items");
    expect(getRes.status).toBe(200);

    const postRes = await app.request("/items", { method: "POST" });
    expect(postRes.status).toBe(200);
  });

  test("handler receives RouterContext", async () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();
    const bodySchema = z.object({ title: z.string() });

    const createPost = route({
      method: "post",
      path: "/posts",
      operation: {
        operationId: "createPost",
        requestBody: jsonRequest(bodySchema),
        responses: {
          201: jsonResponse(z.object({ id: z.string() }), {
            description: "Created",
          }),
        },
      },
      setup: () => async (event, ctx) => {
        const body = await ctx.body(event);
        return ctx.reply(event, 201, { id: "new-" + body.title });
      },
    });

    app.register(box.get(createPost)(paths));

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "hello" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ id: "new-hello" });
  });

  test("setup receives Box instance for dependency injection", async () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();

    class PostService {
      id = Math.random();

      createPost() {
        return { id: this.id };
      }
    }

    const createPost = route({
      method: "post",
      path: "/posts",
      operation: {
        operationId: "createPost",
        responses: {
          201: jsonResponse(z.object({ id: z.number() }), {
            description: "Created",
          }),
        },
      },
      setup(box) {
        const svc = box.get(PostService);
        return (event, ctx) => ctx.reply(event, 201, svc.createPost());
      },
    });

    // The same Box instance is shared, so svc resolved in setup is the singleton
    app.register(box.get(createPost)(paths));

    const res = await app.request("/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({ id: box.get(PostService).id });
  });

  test("calling route again on same path keeps first paths entry", () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();
    const op1 = op("getUser");
    const op2 = op("getUser");

    const getUser1 = route({
      method: "get",
      path: "/users/:id",
      operation: op1,
      setup: () => () => ({}),
    });
    const getUser2 = route({
      method: "get",
      path: "/users/:id",
      operation: op2,
      setup: () => () => ({}),
    });

    app.register(box.get(getUser1)(paths));
    app.register(box.get(getUser2)(paths));

    expect(paths.paths["/users/{id}"]!.get).toBe(op1);
  });

  test("setup can return object with handler for advanced use", async () => {
    const box = new Box();
    const app = new H3();
    const paths = new OpenApiPaths();

    const createPost = route({
      method: "post",
      path: "/posts",
      operation: op("createPost"),
      setup: () => ({
        meta: { auth: true },
        handler: () => ({ created: true }),
      }),
    });

    app.register(box.get(createPost)(paths));

    const res = await app.request("/posts", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ created: true });
  });

  describe("router.route()", () => {
    test("registers multiple routes' operations in paths", () => {
      const box = new Box();
      const app = new H3();
      const router = useRouter(app);
      const getOp = op("getPost");
      const createOp = op("createPost");

      const getPost = route({
        method: "get",
        path: "/posts/:id",
        operation: getOp,
        setup: () => () => ({}),
      });
      const createPost = route({
        method: "post",
        path: "/posts",
        operation: createOp,
        setup: () => () => ({}),
      });

      router.route(box.get(getPost), box.get(createPost));

      expect(router.paths()["/posts/{id}"]!.get).toBe(getOp);
      expect(router.paths()["/posts"]!.post).toBe(createOp);
    });

    test("mounts all route handlers on the app", async () => {
      const box = new Box();
      const app = new H3();
      const router = useRouter(app);

      const getPost = route({
        method: "get",
        path: "/posts/:id",
        operation: op("getPost"),
        setup: () => () => ({ method: "get" }),
      });
      const createPost = route({
        method: "post",
        path: "/posts",
        operation: op("createPost"),
        setup: () => () => ({ method: "post" }),
      });

      router.route(box.get(getPost), box.get(createPost));

      const getRes = await app.request("/posts/1");
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toStrictEqual({ method: "get" });

      const postRes = await app.request("/posts", { method: "POST" });
      expect(postRes.status).toBe(200);
      expect(await postRes.json()).toStrictEqual({ method: "post" });
    });

    test("handlers receive RouterContext", async () => {
      const box = new Box();
      const app = new H3();
      const router = useRouter(app);
      const paramsSchema = z.object({ id: z.coerce.number() });

      const getPost = route({
        method: "get",
        path: "/posts/:id",
        operation: {
          operationId: "getPost",
          requestParams: { path: paramsSchema },
          responses: {},
        },
        setup: () => async (event, ctx) => {
          const { id } = await ctx.params(event);
          return { id };
        },
      });

      router.route(box.get(getPost));

      const res = await app.request("/posts/42");
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ id: 42 });
    });

    test("registering the same route twice keeps first paths entry", async () => {
      const box = new Box();
      const app = new H3();
      const router = useRouter(app);
      const op1 = op("getPost1");
      const op2 = op("getPost2");

      const getPost1 = route({
        method: "get",
        path: "/posts/:id",
        operation: op1,
        setup: () => () => ({ op: 1 }),
      });
      const getPost2 = route({
        method: "get",
        path: "/posts/:id",
        operation: op2,
        setup: () => () => ({ op: 2 }),
      });

      router.route(box.get(getPost1), box.get(getPost2));

      expect(router.paths()["/posts/{id}"]!.get).toBe(op1);

      const res = await app.request("/posts/1");
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ op: 1 });
    });
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
