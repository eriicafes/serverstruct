import { AnyHollywood, inferContainer } from "hollywood-di"
import { Env, Hono } from "hono"
import { Controller } from "./controller"
import { Module } from "./module"
import { MergePath } from "./utils/types"

export interface Serverstruct<Container extends AnyHollywood, BasePath extends string> {
    modules(...modules: Module<BasePath, any, inferContainer<Container>>[]): this
    controllers(...controllers: Controller<BasePath, any, inferContainer<Container>, any, any, any>[]): this
}

export function serverstruct<
    App extends Hono<any, any, BasePath>,
    Container extends AnyHollywood,
    BasePath extends string = "/"
>(app: App, container: Container, _base?: BasePath): Serverstruct<Container, BasePath> {
    return {
        controllers(...controllers) {
            registerControllers(app, container, controllers)
            return this
        },
        modules(...modules) {
            for (const module of modules) {
                registerModule(app, container, module)
            }
            return this
        },
    }
}

function registerControllers<
    BasePath extends string,
    App extends Hono<any, any, BasePath>,
    Container extends AnyHollywood,
>(
    app: App,
    container: Container,
    controllers: Controller<BasePath, any, inferContainer<Container>, any, any, any>[],
) {
    for (const controllerInit of controllers) {
        // instantiate controller
        const controller = container.resolve(controllerInit as Controller<BasePath, any, {}>)
        controller.mountTo(app)
    }
}

function registerModule<
    BasePath extends string,
    App extends Hono<any, any, BasePath>,
    Container extends AnyHollywood,
>(
    app: App,
    container: Container,
    module: Module<BasePath, any, inferContainer<Container>>,
) {
    // create child container
    const moduleContainer = container.createChild(module.tokens)

    // register module controllers
    const subapp = new Hono<Env, {}, MergePath<BasePath, any>>()
    registerControllers(subapp, moduleContainer, module.controllers as Controller<MergePath<BasePath, any>, any, {}>[])

    // register submodules
    for (const submodule of module.submodules ?? []) {
        registerModule(subapp, moduleContainer, submodule as Module<MergePath<BasePath, any>, any, {}>)
    }

    // add module router to parent router
    app.route(module.path, subapp)
}

export { Controller, ControllerContext, createController, inferController, Router } from "./controller"
export { createModule, Module, ModuleConfig } from "./module"
