/* Runs every suite against a locally served copy of the site.
 *
 *   npm run test:setup     # once — installs the vendored CDN assets
 *   npm test
 *
 * Starts its own static server unless BASE is already pointing somewhere.
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const SUITES = ["page", "undated", "clusters", "places", "regressions"];
const PORT = 8000;
const own = !process.env.BASE;

function get(url) {
  return new Promise(function (resolve) {
    const req = http.get(url, function (res) { res.resume(); resolve(res.statusCode); });
    req.on("error", function () { resolve(0); });
    req.setTimeout(500, function () { req.destroy(); resolve(0); });
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    if (await get("http://127.0.0.1:" + PORT + "/index.html") === 200) return true;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return false;
}

function run(file) {
  return new Promise(function (resolve) {
    const p = spawn(process.execPath, [path.join(__dirname, file + ".js")], { stdio: "inherit" });
    p.on("exit", function (code) { resolve(code === 0); });
  });
}

(async function () {
  let server = null;

  if (own) {
    if (await get("http://127.0.0.1:" + PORT + "/index.html") === 200) {
      console.log("Using the server already on :" + PORT + "\n");
    } else {
      server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
        cwd: path.join(__dirname, ".."), stdio: "ignore"
      });
      if (!await waitForServer()) {
        console.error("Could not start a static server on :" + PORT);
        if (server) server.kill();
        process.exit(1);
      }
    }
  }

  const failed = [];
  for (const suite of SUITES) {
    console.log("\n" + "=".repeat(58) + "\n" + suite + "\n" + "=".repeat(58));
    if (!await run(suite)) failed.push(suite);
  }

  if (server) server.kill();

  console.log("\n" + "=".repeat(58));
  if (failed.length) {
    console.log("FAILED: " + failed.join(", "));
    process.exit(1);
  }
  console.log("All " + SUITES.length + " suites passed.");
})();
