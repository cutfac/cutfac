import { describe, expect, test } from "bun:test";

import { decodeIconManifest, devIconManifest } from "../electron/devApp.ts";

describe("the Cutfac Dev icon", () => {
  test("puts the DEV band in front of the icon's front group, out of the glass", () => {
    const front = { layers: [{ "image-name": "front.svg", glass: true }], specular: true };
    const back = { layers: [{ "image-name": "back.svg" }], shadow: { kind: "none" } };

    expect(devIconManifest({ fill: "automatic", groups: [front, back] })).toEqual({
      fill: "automatic",
      groups: [
        {
          layers: [{ "image-name": "dev.svg", name: "dev", glass: false }, ...front.layers],
          specular: true,
        },
        back,
      ],
    });
  });

  test("lays over the icon the repository ships", async () => {
    const manifest = await Bun.file(
      new URL("../build/icon.icon/icon.json", import.meta.url),
    ).json();

    const [front] = devIconManifest(decodeIconManifest(manifest)).groups;

    expect(front.layers[0]).toEqual({ "image-name": "dev.svg", name: "dev", glass: false });
  });

  test("refuses a manifest with no group to lay the band in", () => {
    expect(() => decodeIconManifest({ groups: [] })).toThrow();
    expect(() => decodeIconManifest({})).toThrow();
  });
});
