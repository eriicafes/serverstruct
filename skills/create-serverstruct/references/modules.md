# Module Reference

Read this file completely when creating or changing domain modules, controllers, services, middleware, or controller tests.

## Models and Errors

Keep reusable public models and domain-specific errors in the domain's single `module.ts`.

```typescript
// modules/users/module.ts
import { z } from "zod";

export class UserModels {
  static user = z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
  });
}

export class UserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`User ${userId} was not found.`);
  }
}
```

## Services

Service methods accept plain values and return domain values or domain failures. Put internal lookup, normalization, and persistence steps on private methods instead of free-standing functions.

```typescript
// modules/users/service.ts
import { Database } from "#/lib/database";
import { inject } from "getbox/context";

export interface CreateUserInput {
  email: string;
  name: string;
}

export class UserService {
  private db = inject(Database);

  getUser(userId: string) {
    return this.db.users.findById(userId);
  }

  createUser(input: CreateUserInput) {
    return this.db.users.create({
      ...input,
      email: this.normalizeEmail(input.email),
    });
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}
```

## Controller

The DTO consumes the actual database or internal type and constructs the public response object. It does not parse the object through its response schema.

```typescript
// modules/users/controller.ts
import type { UserRecord } from "#/lib/database";
import { HTTPError } from "h3";
import { controller } from "serverstruct";
import { jsonResponse, schemas, useRouter } from "serverstruct/openapi";
import { z } from "zod";
import { UserModels } from "./module";
import { UserService } from "./service";

export class UserSchemas {
  static getUser = schemas({
    params: z.object({
      userId: z.string(),
    }),
    response: z.object({
      data: UserModels.user,
    }),
    notFound: z.object({
      message: z.string(),
    }),
  });
}

class UserDTO {
  user(row: UserRecord): z.infer<typeof UserModels.user> {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
    };
  }
}

export const UserController = controller((app, box) => {
  const deps = box.get({ users: UserService });
  const dto = new UserDTO();
  const router = useRouter(app);

  router.get(
    "/:userId",
    {
      tags: ["Users"],
      operationId: "getUser",
      summary: "Get a user",
      requestParams: {
        path: UserSchemas.getUser.params,
      },
      responses: {
        200: jsonResponse(UserSchemas.getUser.response, {
          description: "The user account.",
        }),
        404: jsonResponse(UserSchemas.getUser.notFound, {
          description: "The user does not exist.",
        }),
      },
    },
    async (event, ctx) => {
      const params = await ctx.params(event);

      const user = await deps.users.getUser(params.userId);

      if (!user) {
        return new HTTPError({ status: 404, message: "User not found." });
      }
      return ctx.reply(event, 200, { data: dto.user(user) });
    },
  );
});
```

## Handler Grouping

Keep params, query, body, and request-context reads in one uninterrupted opening block. Keep the parsed request objects whole, then place one blank line after this group.

```typescript
async (event, ctx) => {
  const params = await ctx.params(event);
  const query = await ctx.query(event);
  const body = await ctx.body(event);
  const session = authCtx.get(event);
  const requestMeta = requestMetaCtx.get(event);

  const isOwnAccount = session.user.id === params.userId;
  if (!isOwnAccount) {
    return new HTTPError({ status: 403, message: "Unauthorized." });
  }

  const updatedUser = await deps.users.updateUser(params.userId, body, {
    notify: query.notify,
    requestId: requestMeta.requestId,
  });

  if (!updatedUser) {
    return new HTTPError({ status: 404, message: "User not found." });
  }
  return ctx.reply(event, 200, { data: dto.user(updatedUser) });
};
```

## Middleware and Context

Middleware factories resolve dependencies from their `box`. Request context is typed and set once by middleware.

```typescript
export const AuthMiddleware = factory((box) => {
  const auth = box.get(Auth);

  return defineMiddleware(async (event) => {
    const session = await auth.session(event.headers);
    authCtx.set(event, session);
  });
});
```

```typescript
interface RequestMeta {
  requestId: string;
}

export const requestMetaCtx = context<RequestMeta>({
  onError: "Request metadata is unavailable.",
});

app.use((event) => {
  requestMetaCtx.set(event, { requestId: crypto.randomUUID() });
});
```

## Controller Test

Resolve the controller and supporting services from one Box at `describe` scope.

```typescript
import { inject, withBox } from "getbox/context";
import { controller } from "serverstruct";
import { describe, expect, it } from "vitest";
import { UserController } from "./controller";
import { UserService } from "./service";

describe("UserController", () => {
  const { app, users } = withBox(() => {
    const app = controller((app, box) => {
      app.mount("/users", box.get(UserController));
    });

    return {
      app: inject(app),
      users: inject(UserService),
    };
  });

  it("returns a user", async () => {
    const user = await users.createUser({
      email: "ada@example.com",
      name: "Ada",
    });
    const response = await app.request(`/users/${user.id}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: user });
  });
});
```
