import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const page = (name: string) => readFileSync(resolve(root, name), "utf8");
const attr = (html: string, selector: RegExp) => html.match(selector)?.[1];
// Files under public/ are served from the site root.
const served = (href: string) => existsSync(resolve(root, "public", href.replace(/^\//, "")));

describe("editor page", () => {
  const html = page("index.html");

  it("has an SVG favicon, a PNG fallback and an Apple touch icon, all present", () => {
    for (const rel of [/rel="icon" type="image\/svg\+xml" href="([^"]+)"/, /rel="icon" type="image\/png" [^>]*href="([^"]+)"/, /rel="apple-touch-icon" href="([^"]+)"/]) {
      const href = attr(html, rel);
      expect(href, String(rel)).toBeTruthy();
      expect(served(href!), href).toBe(true);
    }
  });

  it("has description, Open Graph and Twitter card tags for link previews", () => {
    expect(attr(html, /name="description" content="([^"]+)"/)).toMatch(/projection/i);
    expect(attr(html, /property="og:title" content="([^"]+)"/)).toBe("auto-mapper");
    expect(attr(html, /property="og:type" content="([^"]+)"/)).toBe("website");
    expect(attr(html, /name="twitter:card" content="([^"]+)"/)).toBe("summary_large_image");
    // Link previews need an absolute image URL; the app itself only runs locally.
    const image = attr(html, /property="og:image" content="([^"]+)"/)!;
    expect(image).toMatch(/^https:\/\/raw\.githubusercontent\.com\/ericdahl-dev\/auto-mapper\/main\/frontend\/public\/social\.png$/);
    expect(served("social.png")).toBe(true);
    expect(attr(html, /name="theme-color" content="([^"]+)"/)).toBe("#111111");
  });
});

describe("output page", () => {
  const html = page("output.html");

  it("uses its own icon so its tab is easy to tell from the editor's", () => {
    const href = attr(html, /rel="icon" type="image\/svg\+xml" href="([^"]+)"/);
    expect(href).toBe("/favicon-output.svg");
    expect(served(href!)).toBe(true);
    expect(html).toContain("<title>Output · auto-mapper</title>");
  });
});
