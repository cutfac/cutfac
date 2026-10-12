// Bun inlines files imported `with { type: "text" }`; TypeScript only needs to know they are strings.
declare module "*.md" {
  const text: string;
  export default text;
}
