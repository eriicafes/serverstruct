import { factory, Hollywood, inferContainer } from "hollywood-di"
import { Hono } from "hono"
import { describe } from "node:test"
import { expect, test } from "vitest"
import { createController, serverstruct } from "../src"

describe("Controller", () => {
    const app = new Hono()
    const container = Hollywood.create({
        env: factory(() => "testing")
    })

    const controller1 = createController("/").build(({ router }) => {
        return router
            .get("/", (ctx) => {
                return ctx.text("success", 201)
            })
    })

    const controller2 = createController<"/", "/env", inferContainer<typeof container>>("/env").build(({ router, container }) => {
        return router
            .get("/", (ctx) => {
                return ctx.jsonT({ env: container.env })
            })
    })

    serverstruct(app, container).controllers(controller1, controller2)

    test("matches controller routes", async () => {
        const res = await app.request("/")
        const body = await res.text()
        expect(res.status).toBe(201)
        expect(body).toBe("success")
    })

    test("controller can access container", async () => {
        const res = await app.request("/env").then(res => res.json())
        expect(res).toStrictEqual({ env: container.instances.env })
    })
})
