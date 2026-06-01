/**
 * Minimal `DataTransfer` stand-in for drag-and-drop tests — jsdom doesn't
 * implement the real thing. Carries the `setData`/`getData`/`types` surface the
 * course-drag helpers touch; optionally seed it with one entry.
 */
export function fakeDataTransfer(seed?: { type: string; value: string }) {
  const store: Record<string, string> = {};
  const dt = {
    types: [] as string[],
    effectAllowed: "" as string,
    dropEffect: "" as string,
    setData(type: string, value: string) {
      store[type] = value;
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type: string) {
      return store[type] ?? "";
    },
  };
  if (seed) dt.setData(seed.type, seed.value);
  return dt;
}
