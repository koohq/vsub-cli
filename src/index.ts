#!/usr/bin/env node

import { createProgram } from "./cli.js";
import { cleanOldBinariesOnStartup } from "./updater.js";

// Clean any leftover .old binaries from prior self-updates (standalone binary only)
cleanOldBinariesOnStartup();

void createProgram().parseAsync(process.argv);
