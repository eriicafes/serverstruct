import {
  AnyHollywood,
  ContainerOptions,
  Hollywood,
  HollywoodOf,
  InferContainer,
  RegisterTokens,
} from "hollywood-di";
import { Hono } from "hono";
import { IsEmptyObject, KnownMappedKeys, Merge, Spread } from "./types";

type SubModule<T extends Record<string, any> = any> = {
  app: (
    container: IsEmptyObject<T> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<T>
  ) => Hono<any, any, any>;
};
type SubModules<TContainer extends Record<string, any> = any> = Record<
  string,
  SubModule<TContainer>
>;
type InferSubModules<R extends SubModules = {}> = {
  [K in keyof R]: R[K] extends Module<infer App, any, any> ? App : never;
} & {};

class Module<
  App extends Hono<any, any, any>,
  Deps extends Record<string, any>,
  Modules extends SubModules
> {
  constructor(
    private _context: [
      tokens:
        | { tokens: RegisterTokens<any, any>; options?: ContainerOptions }
        | undefined,
      routes: SubModules<any>
    ][],
    private _route: (container: Deps, modules: InferSubModules<Modules>) => App
  ) {}

  app(
    container: IsEmptyObject<Deps> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<Deps>
  ): App;
  app(): IsEmptyObject<Deps> extends true ? App : never;
  app(
    container?: IsEmptyObject<Deps> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<Deps>
  ): App {
    let currentContainer = container;

    const resolvedModules: Record<string, Hono<any, any, any>> = {};
    for (const [tokens, submodules] of this._context) {
      let subContainer = currentContainer;
      if (tokens && subContainer) {
        subContainer = Hollywood.createWithParent(
          subContainer,
          tokens.tokens,
          tokens.options
        );
      } else if (tokens) {
        subContainer = Hollywood.create(tokens.tokens, tokens.options);
      }
      currentContainer = subContainer;

      for (const [key, submodule] of Object.entries(submodules)) {
        resolvedModules[key] = submodule.app(subContainer as HollywoodOf<Deps>);
      }
    }

    const instances = currentContainer?.instances ?? {};
    return this._route(
      instances as Deps,
      resolvedModules as unknown as InferSubModules<Modules>
    );
  }
}

class ModuleBuilder<
  App extends Hono<any, any, any>,
  Deps extends Record<string, any>,
  Modules extends SubModules,
  Container extends AnyHollywood | undefined
> {
  constructor(private app: App) {}

  private context: [
    tokens:
      | { tokens: RegisterTokens<any, any>; options?: ContainerOptions }
      | undefined,
    modules: SubModules<
      Container extends AnyHollywood
        ? KnownMappedKeys<InferContainer<Container>>
        : Deps
    >
  ][] = [];

  use<
    T extends Container extends AnyHollywood ? never : Record<string, any>
  >() {
    return this as unknown as Container extends AnyHollywood
      ? never
      : ModuleBuilder<App, T, Modules, HollywoodOf<T>>;
  }

  public provide<T extends Record<string, any> = {}>(
    tokens: RegisterTokens<
      T,
      Container extends AnyHollywood ? InferContainer<Container> : Deps
    >,
    options?: ContainerOptions
  ) {
    this.context.push([{ tokens, options }, {}]);
    return this as unknown as ModuleBuilder<
      App,
      Deps,
      Modules,
      Container extends AnyHollywood
        ? Hollywood<T, InferContainer<Container>>
        : Hollywood<T, {}>
    >;
  }

  submodules<
    T extends SubModules<
      Container extends AnyHollywood
        ? KnownMappedKeys<InferContainer<Container>>
        : Deps
    >
  >(modules: T) {
    if (!this.context.length) this.context.push([undefined, modules]);
    else {
      const [, submodules] = this.context[this.context.length - 1];
      Object.assign(submodules, modules);
    }
    return this as unknown as ModuleBuilder<
      App,
      Deps,
      Spread<Merge<T, Modules>>,
      Container
    >;
  }

  route<T extends Hono<any, any, any>>(
    fn: (
      app: App,
      container: Container extends AnyHollywood
        ? KnownMappedKeys<InferContainer<Container>>
        : Deps,
      modules: InferSubModules<Modules>
    ) => T
  ) {
    return new Module<T, Deps, Modules>(this.context, (container, modules) => {
      return fn(
        this.app,
        container as Container extends AnyHollywood
          ? KnownMappedKeys<InferContainer<Container>>
          : Deps,
        modules
      );
    });
  }
}

export function createModule<App extends Hono<any, any, any> = Hono>(
  app: App
): ModuleBuilder<App, {}, {}, undefined>;
export function createModule(): ModuleBuilder<Hono, {}, {}, undefined>;
export function createModule<App extends Hono<any, any, any> = Hono>(
  app?: App
) {
  return new ModuleBuilder<App, {}, {}, undefined>(app ?? (new Hono() as App));
}
