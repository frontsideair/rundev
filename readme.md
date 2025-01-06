# rundev

## Main Command: rundev

* Description: The primary command for initializing and managing the dev environment.
* Workflow:
	* Reads the packageManager and its version from package.json.
	* Installs dependencies using the detected package manager.
	* Starts the dev server using the start script from package.json.
	* Sets up a file watcher for the lockfile to detect changes:
		* Reinstalls dependencies if the lockfile changes.
		* Restarts the dev server if necessary.

## Optional Commands

### `rundev add <package-name>`
* Description: Adds a dependency without triggering redundant reinstalls.
* Workflow:
	* Runs the appropriate package manager command (e.g., npm install <package-name>).
	* Updates dependencies efficiently without duplicating installation steps.

### `rundev <script-name>`
* Description: Runs a script from package.json quickly via the native tool.
* Workflow:
	* Executes the specified script defined in package.json.
	* Bypasses the slower npm run or yarn run.

## Potential Features for Consideration

* Package Manager Installation
	* Installs the required package manager if it's not already present, filling the gap left by Corepack.
* Node.js Version Management
	* Reads the engines field in package.json to ensure the correct Node.js version is used.
	* Installs and manages Node.js versions via tools like nvm.
* Dev Server Restart Optimization
	* Detects if the dev server (e.g., Next.js) supports automatic restarts on dependency changes.
	* Skips manual restarts if the server already handles it.
* Custom Watchers
	* Extend file watching to include additional files (e.g., .env changes) based on project needs.

## First-Time Use for a Project Maintainer

### Integration Steps

* Add rundev to Project Documentation:
	* Update your project's README.md or equivalent with a section like:

```markdown
## Setting Up
1. Clone the repository.
2. Run `rundev` to install dependencies and start the development server.
```

* Ensure Compatibility:
	* Include a packageManager field in your package.json to specify the required package manager and version (e.g., "packageManager": "npm@8.19.2").
	* If applicable, update the engines field to specify the Node.js version needed (e.g., "engines": { "node": ">=16.0.0" }).
* Recommend Installation:
	* Suggest developers globally install rundev for ease of use:

```bash
npm install -g rundev
```

### Benefits for the Project Maintainer

* Simplified Onboarding:
	* No need for contributors to memorize setup steps (npm install, nvm use, etc.). Running rundev automates everything.
* Consistency:
	* Ensures all contributors use the correct package manager and Node.js version, reducing "works on my machine" issues.
* Streamlined Updates:
	* Automatically handles lockfile changes, dependency updates, and dev server restarts, keeping the local environment synced with project changes.
* Better Performance:
	* Native CLI is faster than npm scripts, leading to a smoother development experience.

## Daily Developer Workflow with rundev

### Starting Work

* Update Project:
	* Pull the latest changes from the repository:

```bash
git pull
```

* Run rundev to ensure dependencies are installed and the dev server starts:

```bash
rundev
```

* Dependencies are installed if needed.
* The dev server starts automatically.

### Making Changes

* Adding New Dependencies:
	* Use rundev add to add a dependency:

```bash
rundev add lodash
```

* Avoids redundant dependency reinstalls.

* Switching Branches:
	* Simply switch branches:

```bash
git checkout feature-branch
```

* rundev watches the lockfile, reinstalls dependencies if it changes, and restarts the dev server as needed.

### Running Scripts

* Execute a script from package.json using `rundev <script-name>`:

```bash
rundev build
```

* Bypasses npm run or yarn run for faster script execution.


### Benefits for Developers

* Minimal Setup: No need to remember npm install, manually restart the dev server, or worry about mismatched environments.
* Smooth Transitions: Seamless handling of lockfile updates when switching branches or merging code.
* Fast Commands: Native speed for tasks like running scripts or adding dependencies.
* Hassle-Free Dev Server: Automatically manages server restarts only when necessary.

## Specifications for rundev Setup Requirements

### Required package.json Fields

* For rundev to work optimally, the following fields must be present:
	* packageManager: Specifies the package manager and version (e.g., npm@8.19.2)
	* engines: Indicates the required Node.js version (e.g., "node": ">=16.0.0")
	* start Script: Defines the command to start the dev server (e.g., "start": "next dev")

### Onboarding Wizard

If any of the required fields are missing, rundev prompts the user with:

```
This project doesn't seem to be configured to take advantage of rundev. Would you like to configure it now? (y/n)
```

### Steps in the Wizard

1. Node.js Version:
	* Default: Detect the Node.js version in the current environment
	* Prompt: "What Node.js version does this project require? (default: X.Y.Z)"

2. Package Manager:
	* Default: Infer from the lockfile (package-lock.json, yarn.lock, etc.)
	* Prompt: "What package manager does this project use? (default: npm)"
	* Follow-up: If the version isn't clear, ask for the specific version

3. Dev Server Script:
	* Prompt: "What script should be used to start the dev server? (e.g., next dev, vite dev)"

4. Summary Confirmation:
	* Display the collected values:

```
These values will be added to package.json:
- Node.js version: >=X.Y.Z
- Package manager: npm@8.19.2
- Dev server command: next dev
Confirm? (y/n)
```

5. Write Changes:
	* Add the packageManager, engines, and start fields to package.json
	* Notify the user of successful configuration:
	```
	Your project is now configured for rundev. Run rundev to get started!
	```
