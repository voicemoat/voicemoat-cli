#!/usr/bin/env node
import { main } from "../src/cli.mjs";

// exitCode, not process.exit(): exiting hard while fetch sockets are still
// closing trips a libuv assertion on Windows (src\win\async.c).
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    process.stderr.write(`voicemoat: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  },
);
