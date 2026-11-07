#!/usr/bin/env node

import path from "node:path";
import { createProgram } from "./cli.js";
import { cleanOldBinaries } from "./updater.js";

// Clean any leftover .old binaries from prior self-updates
cleanOldBinaries(path.dirname(process.execPath));

void createProgram().parseAsync(process.argv);
