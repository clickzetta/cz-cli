#!/usr/bin/env bun
import { createCli } from "./cli.js"

const cli = createCli(process.argv.slice(2))
cli.demandCommand(1, "").help().parse()
