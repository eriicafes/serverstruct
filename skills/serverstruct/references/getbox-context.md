# Getbox Context Reference

Use this only when the task specifically wants `withBox()` / `inject()` from `getbox/context`.

## When To Prefer It

- the codebase already uses `withBox()` and `inject()`
- the user wants AsyncLocalStorage-style dependency access
- avoiding constructor params and `static init` is an explicit goal

If the project is already using constructor injection with `Box.init`, stay consistent and do not mix styles casually.

## Typical Pattern

```typescript
import { controller, serve } from "serverstruct";
import { withBox, inject } from "getbox/context";

class UserService {
  private db = inject(Database);
  private logger = inject(Logger);

  find(id: string) {
    return this.db.query(id);
  }
}

const App = controller((app) => {
  app.mount("/users", inject(usersController));
});

withBox(() => {
  const [app, config] = inject([App, Config]);
  serve(app, { port: config.env.PORT });
});
```

## Testing

Pass an explicit box to `withBox()` so mocks are in place before the scope runs.

```typescript
const box = new Box();
Box.mock(box, UserStore, { getAll: () => [{ id: "1" }] });

await withBox(box, async () => {
  const app = inject(App);
  const res = await app.request("/users");
  expect(await res.json()).toEqual([{ id: "1" }]);
});
```

## Rules

- `inject()` should run inside a `withBox()` scope
- nested `withBox()` calls create separate scopes
- prefer one DI style per codebase or subsystem
