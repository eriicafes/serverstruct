import {
  AnyHollywood,
  ContainerOptions,
  Hollywood,
  HollywoodOf,
  InferContainer,
  RegisterTokens,
} from "hollywood-di";
import { Env, Hono, Schema } from "hono";
import { BlankEnv, BlankSchema } from "hono/types";
import { IsEmptyObject, KnownMappedKeys, Merge, Spread } from "./types";

type Subroute<T extends Record<string, any> = any> = {
  app: (
    container: IsEmptyObject<T> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<T>
  ) => Hono<any, any>;
};
type Subroutes<TContainer extends Record<string, any> = any> = Record<
  string,
  Subroute<TContainer>
>;
type InferSubroutes<R extends Subroutes = {}> = {
  [K in keyof R]: R[K] extends Route<any, infer App, any> ? App : never;
} & {};

class Route<
  Deps extends Record<string, any>,
  App extends Hono<any, any>,
  Routes extends Subroutes
> {
  constructor(
    private route: (
      app: Hono<any, any>,
      container: any,
      routes: InferSubroutes<Routes>
    ) => App,
    private context: [
      tokens:
        | { tokens: RegisterTokens<any, any>; options?: ContainerOptions }
        | undefined,
      routes: Subroutes<any>
    ][]
  ) {}

  app(
    container: IsEmptyObject<Deps> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<Deps>
  ): App;
  app(container?: never): IsEmptyObject<Deps> extends true ? App : never;
  app(
    container?: IsEmptyObject<Deps> extends true
      ? HollywoodOf<any> | undefined
      : HollywoodOf<Deps>
  ): App {
    let currentContainer = container;

    const resolvedRoutes: Record<string, Hono<any, any>> = {};
    for (const [tokens, subroutes] of this.context) {
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

      for (const [key, subroute] of Object.entries(subroutes)) {
        resolvedRoutes[key] = subroute.app(subContainer as HollywoodOf<Deps>);
      }
    }

    const instances = currentContainer?.instances ?? {};
    return this.route(
      new Hono(),
      instances,
      resolvedRoutes as InferSubroutes<Routes>
    );
  }
}

class RouteBuilder<
  Deps extends Record<string, any>,
  Container extends AnyHollywood | undefined,
  E extends Env,
  S extends Schema,
  Routes extends Subroutes
> {
  private context: [
    tokens:
      | { tokens: RegisterTokens<any, any>; options?: ContainerOptions }
      | undefined,
    routes: Subroutes<
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
      : RouteBuilder<T, HollywoodOf<T>, E, S, Routes>;
  }

  public provide<T extends Record<string, any> = {}>(
    tokens: RegisterTokens<
      T,
      Container extends AnyHollywood ? InferContainer<Container> : Deps
    >,
    options?: ContainerOptions
  ) {
    this.context.push([{ tokens, options }, {}]);
    return this as unknown as RouteBuilder<
      Deps,
      Container extends AnyHollywood
        ? Hollywood<T, InferContainer<Container>>
        : Hollywood<T, {}>,
      E,
      S,
      Routes
    >;
  }

  subroutes<
    T extends Subroutes<
      Container extends AnyHollywood
        ? KnownMappedKeys<InferContainer<Container>>
        : Deps
    >
  >(routes: T) {
    if (!this.context.length) this.context.push([undefined, routes]);
    else {
      const [, subroutes] = this.context[this.context.length - 1];
      Object.assign(subroutes, routes);
    }
    return this as unknown as RouteBuilder<
      Deps,
      Container,
      E,
      S,
      Spread<Merge<T, Routes>>
    >;
  }

  route<App extends Hono<any, any>>(
    fn: (
      app: Hono<E, S>,
      container: Container extends AnyHollywood
        ? KnownMappedKeys<InferContainer<Container>>
        : Deps,
      routes: InferSubroutes<Routes>
    ) => App
  ) {
    return new Route<Deps, App, Routes>(fn, this.context);
  }
}

export function createRoute<E extends Env = BlankEnv>() {
  return new RouteBuilder<{}, undefined, E, BlankSchema, {}>();
}
