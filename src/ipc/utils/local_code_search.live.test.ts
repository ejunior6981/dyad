import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getLocalCodeSearchConfig, searchLocalCode } from "./local_code_search";

// Opt-in smoke test against a real, running Ollama embedding model.
it.runIf(process.env.DYAD_LOCAL_SEARCH_SMOKE === "true")(
  "retrieves authentication code using real local embeddings",
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-live-search-"),
    );
    try {
      const options = {
        query:
          "Where is the user login password verified and a session created?",
        files: [
          {
            path: "src/auth.ts",
            content:
              "export async function signIn(email, password) { const user = await findUser(email); if (!await verifyPassword(password, user.hash)) throw new Error('Invalid credentials'); return createSession(user.id); }",
          },
          {
            path: "src/colors.ts",
            content:
              "export function mixColors(red, green, blue) { return `rgb(${red}, ${green}, ${blue})`; }",
          },
        ],
        appPath: path.join(directory, "app"),
        cacheRoot: path.join(directory, "cache"),
        config: getLocalCodeSearchConfig(),
      };
      const first = await searchLocalCode(options);
      expect(first[0].path).toBe("src/auth.ts");
      expect(await searchLocalCode(options)).toEqual(first);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
