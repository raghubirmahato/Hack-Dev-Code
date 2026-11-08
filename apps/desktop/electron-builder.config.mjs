/** Ordinary release entry; qualification imports the environment-independent factory. */
import { createElectronBuilderConfig, resolveGitHubUpdateRepository } from './scripts/electron-builder-config.mjs'

export { createElectronBuilderConfig, resolveGitHubUpdateRepository }
export default createElectronBuilderConfig()
