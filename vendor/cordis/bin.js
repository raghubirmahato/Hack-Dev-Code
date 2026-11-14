#!/usr/bin/env node

import { Context } from '@hackdevcode/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@hackdevcode/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@hackdevcode/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
