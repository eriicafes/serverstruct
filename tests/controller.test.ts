import { createAdaptorServer } from "@hono/node-server"
import { factory, Hollywood, inferContainer } from "hollywood-di"
import { Hono } from "hono"
import request from "supertest"
import { describe, expect, test } from "vitest"
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
    const server = createAdaptorServer(app)

    test("matches controller routes", async () => {
        const res = await request(server).get("/")
        expect(res.status).toBe(201)
        expect(res.text).toBe("success")
    })

    test("controller can access container", async () => {
        const res = await request(server).get("/env")
        expect(res.body).toStrictEqual({ env: container.instances.env })
    })
})
