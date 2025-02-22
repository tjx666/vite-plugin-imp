import * as fs from 'fs'
import { createRequire } from 'module'
import * as path from 'path'
import chalk from 'chalk'
import { Plugin, ResolvedConfig } from 'vite'

import defaultLibList from './resolvers'
import { analyzeCode, codeIncludesLibraryName, isTranspileDependencies, log } from './shared'
import { ImpConfig } from './types'

const optionsCheck = (options: Partial<ImpConfig>) => {
  if (options?.libList && !Array.isArray(options?.libList)) {
    log(chalk.yellow(`libList is Array, please check your options!`))
    return false
  }
  return true
}

export default function vitePluginImp(userConfig: Partial<ImpConfig> = {}): Plugin {
  let viteConfig: ResolvedConfig
  let config: ImpConfig
  let isSourcemap = false
  const name = 'vite-plugin-imp'
  if (!optionsCheck(userConfig)) {
    return { name }
  }

  return {
    name,
    async configResolved(resolvedConfig) {
      // store the resolved config
      viteConfig = resolvedConfig
      isSourcemap = !!viteConfig.build?.sourcemap
      config = Object.assign(
        {
          libList: [],
          exclude: [],
          ignoreStylePathNotFound: viteConfig.command === 'serve',
          excludeTranspileFiles: [/\.html(\?.*)?$/],
        },
        userConfig
      )

      const libListNameSet: Set<string> = new Set(config.libList.map((lib) => lib.libName))
      // filter defaultLibList from exclude
      let defaultLibFilteredList = defaultLibList.filter(
        (lib) => !config.exclude?.includes(lib.libName)
      )

      // check user package.json to filter LibList from user dependencies
      const userPkgPath = path.resolve(viteConfig.root, 'package.json')
      if (fs.existsSync(userPkgPath)) {
        // @ts-ignore
        const require = createRequire(import.meta.url)
        const userPkg = require(userPkgPath)
        if (userPkg?.dependencies) {
          defaultLibFilteredList = defaultLibFilteredList.filter(
            (item) => userPkg?.dependencies?.[item.libName]
          )
        }
      }

      // merge defaultLibFilteredList to config.libList
      defaultLibFilteredList.forEach((defaultLib) => {
        if (!libListNameSet.has(defaultLib.libName)) {
          config.libList?.push(defaultLib)
          libListNameSet.add(defaultLib.libName)
        }
      })
    },
    transform(code, id) {
      const { transpileDependencies = false } = config
      if (
        !config.excludeTranspileFiles!.some((reg) => reg.test(id)) &&
        (!/(node_modules)/.test(id) || isTranspileDependencies(transpileDependencies, id)) &&
        codeIncludesLibraryName(code, config.libList)
      ) {
        const sourcemap = this?.getCombinedSourcemap()
        const { importStr, codeRemoveOriginImport } = analyzeCode(
          code,
          config,
          viteConfig.command,
          config.ignoreStylePathNotFound
        )

        return {
          code: `${importStr};${viteConfig.command === 'serve' ? code : codeRemoveOriginImport}`,
          map: isSourcemap ? sourcemap : null,
        }
      }
      return {
        code,
        map: null,
      }
    },
  }
}
