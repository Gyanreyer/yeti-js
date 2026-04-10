type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Builtin = Primitive | Function | Date | RegExp | Error;

export type DeepPartial<T> = T extends Builtin
  ? T
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;