// The TopoJSON files are large; typing them as literal JSON would make tsc crawl. They are
// validated structurally at load time instead (see geo.ts).
declare module "@world-emotion/geo-data/world-110m.topo.json" {
  const value: unknown;
  export default value;
}
declare module "@world-emotion/geo-data/world-50m.topo.json" {
  const value: unknown;
  export default value;
}
