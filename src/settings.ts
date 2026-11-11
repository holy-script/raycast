export interface Settings {
  /** Multiplier on the base mouse-look rate. */
  sensitivity: number;
  /** Base horizontal field of view in degrees. */
  fov: number;
  muted: boolean;
}

export const SENSITIVITY_RANGE = { min: 0.4, max: 2.0 } as const;
export const FOV_RANGE = { min: 55, max: 90 } as const;

const STORAGE_KEY = "raycast.settings.v1";

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 70, muted: false };

export function clampSettings(settings: Settings): Settings {
  return {
    sensitivity: Math.min(
      SENSITIVITY_RANGE.max,
      Math.max(SENSITIVITY_RANGE.min, settings.sensitivity),
    ),
    fov: Math.min(FOV_RANGE.max, Math.max(FOV_RANGE.min, settings.fov)),
    muted: settings.muted,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return clampSettings({
      sensitivity:
        typeof parsed.sensitivity === "number"
          ? parsed.sensitivity
          : DEFAULT_SETTINGS.sensitivity,
      fov: typeof parsed.fov === "number" ? parsed.fov : DEFAULT_SETTINGS.fov,
      muted: parsed.muted === true,
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or blocked storage: settings stay in memory.
  }
}
