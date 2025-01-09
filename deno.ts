import fs from "node:fs";
import { dirname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { cwd } from "node:process";
import {
  EMPTY,
  fromEvent,
  lastValueFrom,
  of,
  throwError,
  partition,
  Observable,
  concat,
} from "rxjs";
import {
  distinctUntilChanged,
  debounceTime,
  switchMap,
  startWith,
  map,
  expand,
  switchAll,
  skip,
} from "rxjs/operators";
import { fromPromise } from "rxjs/internal/observable/innerFrom";
import { z } from "zod";
import semver, { SemVer } from "semver";
import { spawn } from "node:child_process";
import {
  ensureNodeVersion,
  ensurePackageManager,
  getRegistry,
  type PackageManager,
  type PackageManagerResult,
  type PackageManagerSpec,
} from "./rundev.ts";

const isRoot = (path: string) => path === dirname(path);

function findProjectRoot(startPath: string, filename: string) {
  return of(startPath).pipe(
    expand((path) => {
      return fromPromise(
        stat(join(path, filename)).then(
          () => EMPTY,
          () =>
            isRoot(path)
              ? throwError(() => new Error("reached the filesystem root"))
              : of(dirname(path))
        )
      ).pipe(switchAll());
    })
  );
}

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerSpec> = {
  npm: {
    executableName: "npm",
    lockfile: "package-lock.json",
    installCommand: "install",
  },
  yarn: {
    executableName: "yarn",
    lockfile: "yarn.lock",
    installCommand: "install",
  },
  pnpm: {
    executableName: "pnpm.cjs",
    lockfile: "pnpm-lock.yaml",
    installCommand: "install",
  },
};

const PACKAGE_JSON = "package.json";

const packageJsonSchema = z.object({
  packageManager: z.string().optional(),
  engines: z
    .object({
      node: z.string().optional(),
      npm: z.string().optional(),
      yarn: z.string().optional(),
      pnpm: z.string().optional(),
    })
    .optional(),
});

type PackageJson = z.infer<typeof packageJsonSchema>;

function parseVersion(version?: string): string | undefined {
  try {
    return version && semver.minVersion(version, { loose: true })?.version;
  } catch {
    return undefined;
  }
}

function determineNodeVersion(packageJson: PackageJson): string | undefined {
  const nodeVersionString = packageJson?.engines?.node;
  return parseVersion(nodeVersionString);
}

const packageManagerRegex = RegExp(
  /(?<name>npm|pnpm|yarn|bun)@(?<version>\d+\.\d+\.\d+(-\.\+)?)/
);

function determinePackageManager({
  packageManager,
  engines,
}: PackageJson): PackageManagerResult {
  const packageManagerMatch = packageManager?.match(packageManagerRegex);
  const { name, version } = packageManagerMatch?.groups ?? {};
  const semverVersion = parseVersion(version);

  if (name && semverVersion) {
    return {
      type: "packageManager",
      name: name as PackageManager, // parse with zod
      version: semverVersion,
    };
  }
  if (engines) {
    if (engines.npm) {
      const semverVersion = parseVersion(engines.npm);
      if (semverVersion) {
        return {
          type: "engines",
          name: "npm",
          version: semverVersion,
        };
      }
    }

    if (engines.yarn) {
      const semverVersion = parseVersion(engines.yarn);
      if (semverVersion) {
        return {
          type: "engines",
          name: "yarn",
          version: semverVersion,
        };
      }
    }

    if (engines.pnpm) {
      const semverVersion = parseVersion(engines.pnpm);
      if (semverVersion) {
        return {
          type: "engines",
          name: "pnpm",
          version: semverVersion,
        };
      }
    }
  }
  return {
    type: "bundled",
    name: "npm",
  };
}

function watchFile(path: string) {
  return fromEvent(fs.watch(path), "change").pipe(
    // debounceTime(100),
    startWith(null),
    switchMap(() =>
      fromPromise(
        readFile(path, { encoding: "utf-8" }).catch(() => {
          return null;
        })
      )
    ),
    distinctUntilChanged()
  );
}

function spawnProcess(command: string, args: string[] = []) {
  return new Observable<void>((subscriber) => {
    const proc = spawn(command, args, { stdio: "inherit" });

    proc.on("exit", () => subscriber.complete());
    proc.on("error", (err) => subscriber.error(err));

    return () => proc.kill();
  });
}

async function main() {
  try {
    const projectRoot = await lastValueFrom(
      findProjectRoot(cwd(), PACKAGE_JSON)
    );
    const packageJsonPath = join(projectRoot, PACKAGE_JSON);
    console.log(`project root: ${projectRoot}`);

    const [fileChanges$, fileErrors$] = partition(
      watchFile(packageJsonPath),
      (file) => file !== null
    );

    fileErrors$.subscribe(() => {
      console.log("package.json in project root was destroyed");
    });

    const [packageJsonChanges$, packageJsonErrors$] = partition(
      fileChanges$.pipe(
        switchMap((file) => {
          try {
            return of(packageJsonSchema.parse(JSON.parse(file)));
          } catch {
            return of(null);
          }
        })
      ),
      (file) => file !== null
    );

    packageJsonErrors$.subscribe(() => {
      console.log("package.json at project root cannot be parsed");
    });

    const [versionChange$, versionErrors$] = partition(
      packageJsonChanges$.pipe(
        map((packageJson) => {
          const nodeVersion = determineNodeVersion(packageJson);
          const packageManager = determinePackageManager(packageJson);
          return nodeVersion && packageManager
            ? { nodeVersion, packageManager }
            : null;
        }),
        distinctUntilChanged((prev, curr) => {
          return JSON.stringify(prev) === JSON.stringify(curr);
        })
      ),
      (result) => result !== null
    );

    versionErrors$.subscribe(() => {
      console.log(
        "node version or package manager in package.json cannot be parsed"
      );
    });

    versionChange$
      .pipe(skip(1))
      .subscribe(({ nodeVersion, packageManager }) => {
        console.log("[package.json changed]");
        console.log(`node version: ${nodeVersion}`);
        if (packageManager.type === "bundled") {
          console.log(
            `package manager: bundled ${packageManager.name} (not found in engines or packageManager)`
          );
        } else {
          console.log(
            `package manager: ${packageManager.name}@${packageManager.version} (found in ${packageManager.type})`
          );
        }
      });

    const [storeChanges$, storeErrors$] = partition(
      versionChange$.pipe(
        switchMap(async ({ nodeVersion, packageManager }) => {
          try {
            const packageManagerSpec = PACKAGE_MANAGERS[packageManager.name];
            const registry = await getRegistry();
            const nodePath = await ensureNodeVersion(nodeVersion, registry);
            const packageManagerPath = await ensurePackageManager(
              packageManagerSpec,
              packageManager,
              registry,
              nodeVersion
            );
            return {
              packageManagerSpec,
              nodePath,
              packageManagerPath,
            };
          } catch {
            return null;
          }
        })
      ),
      (file) => file !== null
    );

    storeErrors$.subscribe(() => {
      console.log("node version or package manager cannot be installed");
    });

    const [lockfileChanges$, lockfileErrors$] = partition(
      storeChanges$.pipe(
        switchMap(({ packageManagerSpec, nodePath, packageManagerPath }) => {
          return watchFile(join(projectRoot, packageManagerSpec.lockfile)).pipe(
            map(() => ({
              packageManagerSpec,
              nodePath,
              packageManagerPath,
            }))
          );
        })
      ),
      (file) => file !== null
    );

    lockfileErrors$.subscribe(() =>
      console.log("lockfile in project root was destroyed")
    );

    lockfileChanges$.pipe(skip(1)).subscribe(() => {
      console.log("[lockfile changed]");
    });

    lockfileChanges$
      .pipe(
        switchMap(({ packageManagerSpec, nodePath, packageManagerPath }) => {
          return concat(
            spawnProcess(nodePath, [
              packageManagerPath,
              packageManagerSpec.installCommand,
            ]),
            spawnProcess(nodePath, [packageManagerPath, "run", "dev"])
          );
        })
      )
      .subscribe(() => {
        console.log("installing dependencies and running the dev server");
      });
  } catch (error) {
    if (error instanceof Error) {
      console.log("project root not found:", error.message);
    } else {
      console.log("unknown error");
    }
  }
}

await main();
