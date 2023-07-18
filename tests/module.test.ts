import { alias, factory, Hollywood, inferContainer } from "hollywood-di"
import { Hono } from "hono"
import { describe } from "node:test"
import { expect, test } from "vitest"
import { createController, createModule, serverstruct } from "../src"

describe("Module", () => {
    const app = new Hono()
    const container = Hollywood.create({
        env: factory(() => "testing"),
        innerEnv: factory(() => "inner testing"),
    })

    const controller = createController<"/inner", "/", { env: string }>("/").build(({ router, container }) => {
        return router
            .get("/", (ctx) => {
                return ctx.jsonT({ env: container.env })
            })
    })

    const module = createModule<"/", "/inner", inferContainer<typeof container>>("/inner").build({
        tokens: {
            env: alias<{ innerEnv: string }>().to("innerEnv"),
        },
        controllers: [controller]
    })

    serverstruct(app, container).modules(module)

    test("matches module controller routes", async () => {
        const res = await app.request("/inner")
        const body = await res.json()
        expect(res.status).toBe(200)
        expect(body?.env).not.toBe(container.instances.env)
        expect(body?.env).toBe(container.instances.innerEnv)
    })
})
