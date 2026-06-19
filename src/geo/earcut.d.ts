// three's bundled earcut is a pure, dependency-free polygon triangulator (a port
// of mapbox/earcut). Importing this leaf module — rather than `three` — lets the
// geo worker triangulate building footprints without pulling THREE's core into
// its bundle. The published package ships no .d.ts for the /src path, so declare it.
declare module 'three/src/extras/lib/earcut.js' {
  export default function earcut(
    data: ArrayLike<number>,
    holeIndices?: ArrayLike<number> | null,
    dim?: number,
  ): number[];
}
