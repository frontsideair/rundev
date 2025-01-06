#! /usr/bin/env node

/**
 * Read nearest package.json file
 * Determine node version
 * Determine package manager and version
 * Install those if not installed
 * Daemonize the following, restart if package.json or lockfile has changed
 ** Install packages with package manager
 ** Run dev command with given node version
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import child_process, { spawn, type SpawnOptions } from "node:child_process";
import { promisify } from "node:util";
import { watchFile } from "node:fs";

import * as tar from "tar";
import semver from "semver";

const execFile = promisify(child_process.execFile);

async function findNearestPackageJson() {
  let currentDir = process.cwd();

  while (true) {
    try {
      const packageJson = await fs.readFile(
        path.join(currentDir, "package.json"),
        { encoding: "utf-8" }
      );
      return { projectRoot: currentDir, packageJson: JSON.parse(packageJson) };
    } catch (error) {
      const parentDir = path.dirname(currentDir);
      if (currentDir === parentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }
}

type PackageManager = "npm" | "yarn" | "pnpm";

type PackageManagerSpec = {
  name: PackageManager;
  version: string;
  executableName: string;
  lockfile: string;
  installCommand: string;
};

function generateSpec(
  partialSpec: Omit<PackageManagerSpec, "version">,
  version: string
) {
  const minVersion = semver.minVersion(version);
  if (minVersion) {
    return {
      ...partialSpec,
      version: minVersion.version,
    };
  }
}

function determinePackageManager(
  engines: Record<string, string>
): PackageManagerSpec | undefined {
  if (engines?.npm) {
    return generateSpec(
      {
        name: "npm",
        executableName: "npm",
        lockfile: "package-lock.json",
        installCommand: "install",
      },
      engines.npm
    );
  } else if (engines?.yarn) {
    return generateSpec(
      {
        name: "yarn",
        executableName: "yarn",
        lockfile: "yarn.lock",
        installCommand: "install",
      },
      engines.yarn
    );
  } else if (engines?.pnpm) {
    return generateSpec(
      {
        name: "pnpm",
        executableName: "pnpm.cjs",
        lockfile: "pnpm-lock.yaml",
        installCommand: "install",
      },
      engines.pnpm
    );
  }
}

const STORE_PATH = path.join(os.homedir(), ".rundev");
const REGISTRY_PATH = path.join(STORE_PATH, "registry.json");
const NODE_VERSIONS_PATH = path.join(STORE_PATH, "node-versions");
const PACKAGE_MANAGERS_PATH = path.join(STORE_PATH, "package-managers");

type Registry = {
  nodeVersions: string[];
  packageManagers: Record<PackageManager, string[]>;
};

const DEFAULT_REGISTRY: string = JSON.stringify({
  nodeVersions: [],
  packageManagers: {
    npm: [],
    yarn: [],
    pnpm: [],
  },
});

async function getRegistry(): Promise<Registry> {
  return JSON.parse(
    await fs
      .readFile(REGISTRY_PATH, { encoding: "utf-8" })
      .catch(() => DEFAULT_REGISTRY)
  );
}

async function ensureNodeVersion(version: string, registry: Registry) {
  if (!registry.nodeVersions.includes(version)) {
    await installNodeVersion(version, registry);
  }
  return path.join(NODE_VERSIONS_PATH, version, "bin", "node");
}

async function installNodeVersion(version: string, registry: Registry) {
  const platform = os.platform();
  const arch = os.arch();
  const url = `https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${arch}.tar.gz`;
  const pathToSave = path.join(NODE_VERSIONS_PATH, version);

  await install(url, pathToSave);

  registry.nodeVersions.push(version);
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`Node version ${version} installed successfully.`);
}

async function ensurePackageManager(
  packageManager: PackageManagerSpec | undefined,
  registry: Registry,
  nodeVersion: string
) {
  if (packageManager) {
    const { name, version, executableName } = packageManager;
    if (!registry.packageManagers[name]?.includes(version)) {
      await installPackageManager(name, version, registry);
    }
    return path.join(
      PACKAGE_MANAGERS_PATH,
      name,
      version,
      "bin",
      executableName
    );
  } else {
    return path.join(NODE_VERSIONS_PATH, nodeVersion, "bin", "npm");
  }
}

async function installPackageManager(
  name: PackageManager,
  version: string,
  registry: Registry
) {
  const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  const pathToSave = path.join(PACKAGE_MANAGERS_PATH, name, version);

  await install(url, pathToSave);

  registry.packageManagers[name].push(version);
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`Package manager ${name}@${version} installed successfully.`);
}

async function install(url: string, pathToSave: string) {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${url}`);
    }

    await fs.mkdir(pathToSave, { recursive: true });

    await pipeline(
      Readable.from(response.body),
      tar.x({
        cwd: pathToSave,
        strip: 1,
        strict: true,
      })
    );
  } catch (error) {
    console.error(error);
  }
}

async function spawnAsync(
  command: string,
  args: string[],
  options: SpawnOptions
) {
  const child = spawn(command, args, options);
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`Failed to run ${command} with code ${code}`));
      }
    });
  });
}

async function installDependencies(
  installCommand = "install",
  nodePath: string,
  packageManagerPath: string
) {
  return await spawnAsync(nodePath, [packageManagerPath, installCommand], {
    stdio: "inherit",
  });
}

function runDevServer(nodePath: string, packageManagerPath: string) {
  return spawn(nodePath, [packageManagerPath, "run", "dev"], {
    stdio: "inherit",
  });
}

const NODE_LTS = "22.12.0";

async function main() {
  const result = await findNearestPackageJson();

  if (!result) {
    console.log("Could not find package.json in any parent directory.");
  } else {
    const { packageJson, projectRoot } = result;
    const nodeVersion =
      semver.minVersion(packageJson.engines?.node)?.version ?? NODE_LTS;
    const packageManager = determinePackageManager(packageJson.engines);

    const registry = await getRegistry();

    const packageManagerLog = packageManager
      ? `${packageManager.name}@${packageManager.version}`
      : "node bundled npm";
    console.log(
      `Using node version ${nodeVersion} and ${packageManagerLog} as package manager.`
    );

    const nodePath = await ensureNodeVersion(nodeVersion, registry);
    const packageManagerPath = await ensurePackageManager(
      packageManager,
      registry,
      nodeVersion
    );

    await installDependencies(
      packageManager?.installCommand,
      nodePath,
      packageManagerPath
    );

    let devServer = runDevServer(nodePath, packageManagerPath);

    watchFile(
      path.join(projectRoot, packageManager?.lockfile ?? "package-lock.json"),
      async (current, previous) => {
        if (current.size !== previous.size) {
          devServer.kill();
          console.log(
            `Lockfile changed, reinstalling dependencies and restarting the dev server...`
          );
          await installDependencies(
            packageManager?.installCommand,
            nodePath,
            packageManagerPath
          );
          devServer = runDevServer(nodePath, packageManagerPath);
        }
      }
    );
  }
}

await main();
