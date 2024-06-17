export type Spread<T> = { [K in keyof T]: T[K] } & {};
export type Merge<T, To> = T & Omit<To, keyof T>;
export type IsEmptyObject<T> = keyof T extends never ? true : false;

export type KnownKey<T> = string extends T
  ? never
  : number extends T
  ? never
  : symbol extends T
  ? never
  : T;
export type KnownMappedKeys<T> = { [K in keyof T as KnownKey<K>]: T[K] } & {};
