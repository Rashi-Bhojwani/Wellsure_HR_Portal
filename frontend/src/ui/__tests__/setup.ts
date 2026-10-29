// Shared jsdom setup for the ui component tests: antd's responsive hooks need matchMedia; `phone` switches the viewport.
let phone = false;
export function setPhone(value: boolean): void {
  phone = value;
}
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const width = phone ? 390 : 1440;
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };
  },
});
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
window.scrollTo = () => undefined;
// jsdom does not implement pseudo-element styles; antd's scroll locker asks for them.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((el: Element) => realGetComputedStyle(el)) as typeof window.getComputedStyle;
