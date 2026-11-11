import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  alphaMask,
  colorDistance,
  dilateMask,
  intersectionOverUnion,
  meanOpaqueColor,
  medianColor,
} from "../tools/verify/metrics";
import { fillWorkflow, validateWorkflow, type WorkflowTemplate } from "../tools/comfy/workflow";
import { downsample } from "../tools/stylize/image";

function png(width: number, height: number, pixels: number[][]): PNG {
  const image = new PNG({ width, height });
  pixels.forEach((pixel, index) => {
    image.data[index * 4] = pixel[0];
    image.data[index * 4 + 1] = pixel[1];
    image.data[index * 4 + 2] = pixel[2];
    image.data[index * 4 + 3] = pixel[3];
  });
  return image;
}

describe("style metrics", () => {
  it("counts only pixels above the alpha cutoff", () => {
    const image = png(3, 1, [
      [10, 10, 10, 255],
      [10, 10, 10, 127],
      [10, 10, 10, 128],
    ]);
    expect([...alphaMask(image)]).toEqual([1, 0, 1]);
  });

  it("scores identical, disjoint, and partial masks", () => {
    const a = new Uint8Array([1, 1, 0, 0]);
    const b = new Uint8Array([1, 0, 1, 0]);
    expect(intersectionOverUnion(a, a)).toBe(1);
    expect(intersectionOverUnion(a, new Uint8Array([0, 0, 1, 1]))).toBe(0);
    expect(intersectionOverUnion(a, b)).toBeCloseTo(1 / 3);
    expect(intersectionOverUnion(new Uint8Array(4), new Uint8Array(4))).toBe(1);
  });

  it("averages opaque pixels and ignores transparent ones", () => {
    const image = png(3, 1, [
      [10, 20, 30, 255],
      [200, 100, 0, 0],
      [30, 40, 50, 255],
    ]);
    expect(meanOpaqueColor(image)).toEqual({ r: 20, g: 30, b: 40 });
    expect(meanOpaqueColor(png(1, 1, [[0, 0, 0, 0]]))).toBeNull();
  });

  it("uses a component-wise median for the palette reference", () => {
    expect(
      medianColor([
        { r: 10, g: 100, b: 30 },
        { r: 90, g: 20, b: 50 },
        { r: 30, g: 60, b: 10 },
      ]),
    ).toEqual({ r: 30, g: 60, b: 30 });
    expect(medianColor([])).toBeNull();
  });

  it("measures RGB distance between palette samples", () => {
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 })).toBe(5);
  });

  it("dilates masks by one pixel in four directions", () => {
    const mask = new Uint8Array([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    expect([...dilateMask(mask, 3, 3)]).toEqual([
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ]);
  });
});

describe("premultiplied downsample", () => {
  it("averages colour only where alpha contributes", () => {
    const source = png(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
    const out = downsample(source, 1, 1);
    expect(out.width).toBe(1);
    expect(out.data[0]).toBe(128);
    expect(out.data[1]).toBe(128);
    expect(out.data[2]).toBe(0);
    expect(out.data[3]).toBe(128);
  });
});

describe("ComfyUI workflow", () => {
  it("accepts the checked-in API workflow", () => {
    const template = JSON.parse(
      readFileSync("tools/comfy/workflow_api.json", "utf8"),
    ) as WorkflowTemplate;
    expect(validateWorkflow(template)).toEqual([]);
    expect(Object.keys(template)).toHaveLength(11);
  });

  it("substitutes typed and embedded placeholders", () => {
    const template = {
      "1": { class_type: "Test", inputs: { seed: "__SEED__", text: "frame __NAME__" } },
    };
    expect(fillWorkflow(template, { __SEED__: 7, __NAME__: "idle" })).toEqual({
      "1": { class_type: "Test", inputs: { seed: 7, text: "frame idle" } },
    });
  });

  it("rejects missing placeholders and broken links", () => {
    expect(() => fillWorkflow({ text: "__MISSING__" }, {})).toThrow("__MISSING__");
    const problems = validateWorkflow({
      "1": { class_type: "KSampler", inputs: { model: ["2", 0] } },
    });
    expect(problems).toContain("node 1.model references missing node 2");
    expect(problems).toContain("workflow has no SaveImage node");
  });
});
