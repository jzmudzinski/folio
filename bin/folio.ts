#!/usr/bin/env bun
import { main } from "../src/cli/index";

main(process.argv).then((code) => process.exit(code));
