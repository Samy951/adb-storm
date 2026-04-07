type RenderFn = (container: HTMLElement, params?: Record<string, string>) => CleanupFn | void;
type CleanupFn = () => void;

export class Router {
  private routes = new Map<string, RenderFn>();
  private container: HTMLElement;
  private currentHash = '';
  private cleanup: CleanupFn | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container #${containerId} not found`);
    this.container = el;

    window.addEventListener('hashchange', () => this.handleHash());
    (window as any).__router = this;

    // Handle initial hash on page load/refresh
    requestAnimationFrame(() => this.handleHash());
  }

  add(name: string, render: RenderFn) {
    this.routes.set(name, render);
  }

  navigate(name: string, params?: Record<string, string>) {
    const hash = params
      ? `${name}?${new URLSearchParams(params).toString()}`
      : name;
    window.location.hash = hash;
  }

  private handleHash() {
    const raw = window.location.hash.slice(1) || 'login';
    const [name, query] = raw.split('?');
    const params: Record<string, string> = {};
    if (query) {
      new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    }

    // Compare full hash (route + params) to detect channel changes
    if (raw === this.currentHash) return;
    this.currentHash = raw;

    // Run cleanup from previous page
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }

    const render = this.routes.get(name);
    if (render) {
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }
      const result = render(this.container, params);
      if (typeof result === 'function') {
        this.cleanup = result;
      }
    }
  }
}
