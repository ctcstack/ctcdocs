/**
 * A count and the noun it counts, as the report, the job summary and error
 * messages write it: `1 image`, `3 images`, `2 addresses`.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
