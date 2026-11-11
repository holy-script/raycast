export type InputAction = "toggle-map" | "toggle-fly" | "toggle-debug" | "respawn";

const PREVENT_DEFAULT = new Set([
  "Space",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export class InputController {
  locked = false;
  onLockChange?: (locked: boolean) => void;
  onAction?: (action: InputAction) => void;

  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener("click", () => {
      if (!this.locked) void canvas.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });

    document.addEventListener("mousemove", (event) => {
      if (!this.locked) return;
      this.lookX += event.movementX;
      this.lookY += event.movementY;
    });

    window.addEventListener("keydown", (event) => {
      if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      if (this.locked) this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === "KeyM" || event.code === "Tab") this.onAction?.("toggle-map");
      if (event.code === "F2") this.onAction?.("toggle-fly");
      if (event.code === "F3") this.onAction?.("toggle-debug");
      if (event.code === "KeyR") this.onAction?.("respawn");
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  consumeLook(): { x: number; y: number } {
    const delta = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return delta;
  }
}
