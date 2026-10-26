/** Files imported with the `?raw` suffix are bundled as strings. */
declare module '*?raw' {
  const contents: string;
  export default contents;
}
