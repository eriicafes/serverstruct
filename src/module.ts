import { Hollywood, inferContainer, RegisterTokens } from "hollywood-di"
import { Controller } from "./controller"
import { MergePath } from "./utils/types"

export interface Module<BasePath extends string, Path extends string, P extends Record<string, any>> {
    path: Path
    tokens: RegisterTokens<any, P>
    controllers: Controller<MergePath<BasePath, Path>, any, P, any, any, any>[]
    submodules?: Module<MergePath<BasePath, Path>, any, P>[]
}
export interface ModuleConfig<BasePath extends string, Path extends string, T extends Record<string, any>, P extends Record<string, any>> {
    tokens: RegisterTokens<T, P>
    controllers: Controller<MergePath<BasePath, Path>, any, inferContainer<Hollywood<T, Hollywood<P, any>>>, any, any, any>[]
    submodules?: Module<MergePath<BasePath, Path>, any, inferContainer<Hollywood<T, Hollywood<P, any>>>>[]
}
type ModuleBuilder<
    BasePath extends string = "/",
    Path extends string = "/",
    P extends Record<string, any> = {},
> = {
    build<T extends Record<string, any> = {}>(config: ModuleConfig<BasePath, Path, T, P>): Module<BasePath, Path, P>
}

export function createModule<
    BasePath extends string = "/",
    Path extends string = "/",
    P extends Record<string, any> = {},
>(path: Path): ModuleBuilder<BasePath, Path, P> {
    return {
        build(config) {
            // cast the return as a module to allow usage in modules or submodules array
            return { ...config, path } as Module<BasePath, Path, P>
        },
    }
}
