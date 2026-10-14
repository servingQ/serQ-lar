// set by vite.config.ts: the serQ checkout the page was built from
declare const __SERQ_REF__: string;

// libavoid-js names a typings file it does not ship; flow/route.ts types the parts it uses
declare module "libavoid-js" {
  export const AvoidLib: { load(wasm?: string): Promise<void>; getInstance(): unknown };
}
