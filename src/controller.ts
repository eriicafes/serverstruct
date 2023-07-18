import autoBind from "auto-bind";
import { Hollywood, InitFactory, InstantiableConstructor } from "hollywood-di";
import { Env, Hono } from "hono";
import { MergePath } from "./utils/types";

export type Router<BasePath extends string = "/", Path extends string = "/", E extends Env = Env, S = {}> = Hono<E, S, MergePath<BasePath, Path>>
class ControllerDef<BasePath extends string = "/", Path extends string = "/", E extends Env = Env, S = {}, Out = S> {
    constructor(
        public path: Path,
        public route: (router: Router<BasePath, Path, E, S>) => Router<BasePath, Path, E, Out>,
    ) { }

    public mountTo(parent: Hono<any, any, BasePath>): void {
        // create the typed router
        const router = new Hono() as Hono<E, S, MergePath<BasePath, Path>>
        // register routes with controller
        const mountedRouter = this.route(router)
        // add router to parent which satisfies the path requirements of the controller
        parent.route(this.path, mountedRouter)
    }
}
export type Controller<BasePath extends string, Path extends string, T extends Record<string, any> = {}, E extends Env = Env, S = {}, Out = S> = InitFactory<T, ControllerDef<BasePath, Path, E, S, Out>>
export type inferController<T extends Controller<any, any, any, any, any>> = T extends Controller<infer BasePath, infer Path, any, infer E, any, infer Out> ? Router<BasePath, Path, E, Out> : never
type ControllerInit<T> = <U extends Record<string, any>>(constructor: InstantiableConstructor<T, U>) => U
export type ControllerContext<TContainer, TRouter> = {
    router: TRouter
    container: TContainer
    /**
     * Initialize an instantiable constructor with the controller's container.
     * 
     * Also automatically binds class methods to their instance using `auto-bind`.
     */
    init: ControllerInit<TContainer>
}
type ControllerBuilder<
    BasePath extends string = "/",
    Path extends string = "/",
    T extends Record<string, any> = {},
    E extends Env = Env,
    S = {},
> = {
    build<Out>(config: (ctx: ControllerContext<T, Router<BasePath, Path, E, S>>) => Router<BasePath, Path, E, Out>): Controller<BasePath, Path, T, E, S, Out>
}

export function createController<
    BasePath extends string = "/",
    Path extends string = "/",
    T extends Record<string, any> = {},
    E extends Env = Env,
    S = {},
>(path: Path): ControllerBuilder<BasePath, Path, T, E, S> {
    return {
        build(config) {
            return {
                init(container) {
                    const init: ControllerInit<T> = (constructor) => {
                        const instance = Hollywood.initConstructor(constructor, container)
                        return autoBind(instance)
                    }
                    return new ControllerDef(path, (router) => config({ router, container, init }))
                }
            }
        },
    }
}
