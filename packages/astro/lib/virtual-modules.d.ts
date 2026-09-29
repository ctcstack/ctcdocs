/**
 * The generated sidebar, as the preset hands it to Starlight after normalizing
 * folder labels. `route-injection.ts` serves it to the routes that list the
 * corpus in the reader's order; see `lib/agent-index.ts`.
 */
declare module 'virtual:ctcdocs/navigation' {
  const navigation: readonly unknown[];
  export default navigation;
}
