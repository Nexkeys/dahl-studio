// electron-vite builds `?modulePath` imports as a separate entry and returns its path (used for the PTY host).
declare module '*?modulePath' {
  const src: string
  export default src
}
