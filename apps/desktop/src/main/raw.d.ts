// A file built into the app as text, with no file to find when it runs.
declare module '*?raw' {
  const text: string
  export default text
}
