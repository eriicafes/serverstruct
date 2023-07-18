type IsAny<T> = unknown extends T & string ? true : false;
type WithoutTrailingSlash<T extends string> = T extends `${infer P}/` ? P : T
type WithoutLeadingSlash<T extends string> = T extends `/${infer P}` ? P : T
type WithMinimumSlash<T extends string> = T extends "" ? "/" : T
export type MergePath<P extends string, T extends string> = IsAny<T> extends true
    ? any
    : WithMinimumSlash<WithoutTrailingSlash<`${WithoutTrailingSlash<P>}/${WithoutLeadingSlash<T>}`>>
