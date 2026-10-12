const SDK = new URL("./sdk.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "sdk" || spec === "sdk/db") return { url: SDK, shortCircuit: true };
  return next(spec, ctx);
}
