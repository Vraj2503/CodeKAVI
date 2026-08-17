import { describe, expect, it } from "vitest";
import { folderLabel, folderLabels } from "@/lib/graph/buildFlowGraph";
import type { RepoGraphPayload } from "@/lib/api";

const payload = (paths: string[]) =>
  ({
    files: paths.map((path) => ({
      id: path,
      path,
      name: path.split("/").pop(),
    })),
  }) as RepoGraphPayload;

describe("folderLabel", () => {
  it("names the repo root for top-level files", () => {
    expect(folderLabel("README.md")).toBe("repo root");
  });

  it("keeps short paths whole", () => {
    expect(folderLabel("frontend/README.md")).toBe("frontend");
    expect(folderLabel("frontend/docs/README.md")).toBe("frontend/docs");
  });

  it("drops the head of deep paths, keeping the distinguishing tail", () => {
    expect(folderLabel("a/b/frontend/docs/README.md")).toBe("frontend/docs");
    expect(folderLabel("app/(auth)/auth/signin/page.tsx")).toBe("auth/signin");
  });
});

describe("folderLabels", () => {
  it("labels only files whose basename is shared", () => {
    const labels = folderLabels(
      payload(["app/auth/signin/page.tsx", "app/auth/signin/route.ts"]),
    );
    expect(labels.size).toBe(0);
  });

  it("uses two segments when that already distinguishes", () => {
    const labels = folderLabels(
      payload(["app/auth/signin/page.tsx", "app/auth/set-password/page.tsx"]),
    );
    expect([...labels.values()]).toEqual(["auth/signin", "auth/set-password"]);
  });

  it("grows segments until the labels differ", () => {
    const labels = folderLabels(
      payload(["apps/web/src/api/routes.ts", "apps/admin/src/api/routes.ts"]),
    );
    expect([...labels.values()]).toEqual(["web/src/api", "admin/src/api"]);
  });
});
