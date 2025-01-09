import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SemVer } from "semver";

import * as tar from "tar";

export type PackageManager = "npm" | "yarn" | "pnpm";

export type PackageManagerSpec = {
  executableName: string;
  lockfile: string;
  installCommand: string;
};

export type PackageManagerResult =
  | {
      type: "packageManager" | "engines";
      name: PackageManager;
      version: SemVer["version"];
    }
  | {
      type: "bundled";
      name: "npm";
    };

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

export async function getRegistry(): Promise<Registry> {
  return JSON.parse(
    await fs
      .readFile(REGISTRY_PATH, { encoding: "utf-8" })
      .catch(() => DEFAULT_REGISTRY)
  );
}

export async function ensureNodeVersion(version: string, registry: Registry) {
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

export async function ensurePackageManager(
  packageManagerSpec: PackageManagerSpec,
  packageManager: PackageManagerResult,
  registry: Registry,
  nodeVersion: string
) {
  if (packageManager.type !== "bundled") {
    const { name, version } = packageManager;
    if (!registry.packageManagers[name]?.includes(version)) {
      await installPackageManager(name, version, registry);
    }
    return path.join(
      PACKAGE_MANAGERS_PATH,
      name,
      version,
      "bin",
      packageManagerSpec.executableName
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
